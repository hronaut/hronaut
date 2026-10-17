import type { BrowserWindow, IpcMain, IpcMainInvokeEvent, MessageBoxOptions, MessageBoxReturnValue } from 'electron'
import { homeWorkspaceState, runHomeWorkspaceAction } from './home-workspace-actions.js'
import { openVsCodeMcpInstall } from './vscode-mcp-install.js'
import { ClaudeCodeSetup, claudeCodeConfigPath } from './claude-code-setup.js'
import { detectAgentClients } from './agent-client-detection.js'
import { agentGuideHandler, setupFeedbackHandler, setupHelpHandler } from './setup-feedback-links.js'
import type { McpPortRecovery } from './mcp-port-suggestion.js'
import type { HomeSetupState } from '../shared/claude-code-setup.js'
import type { MessageKey, MessageParameters } from '../shared/i18n.js'
import type { AppSettings, McpPortMoveResult } from '../shared/types.js'

interface HomeIpcHost {
  /** Registers a handler that is refused while saved workspaces are still initializing or failed to start. */
  handleBrowserIpc(channel: string, listener: Parameters<IpcMain['handle']>[1]): void
  /** Why saved workspaces could not start, if they could not; read on every check. */
  workspaceStartupFailure(): Error | undefined
  /** The tab manager Home reads and changes workspaces through; it also covers what `homeWorkspaceState` reads. */
  tabs(): Parameters<typeof runHomeWorkspaceAction>[0] | null
  mainWindow(): Pick<BrowserWindow, 'webContents'> | null
  copyTextToClipboard(text: string): Promise<void>
  reportClipboardFailure(error: unknown): void
  /** The MCP endpoint; read on every use because the port can change in Settings. */
  mcpUrl(): string
  /** The current settings; read on every use because each committed update replaces the object. */
  settings(): AppSettings
  openExternal(url: string): Promise<void>
  mcpPortRecovery(): Pick<McpPortRecovery, 'move'>
  /** Shows a native message box, on the main window when it is open. */
  showMessageBox(options: MessageBoxOptions): Promise<MessageBoxReturnValue>
  text(key: MessageKey, parameters?: MessageParameters): string
}

/** Dependencies stay lazy because handlers are registered before the window loads. */
export function registerHomeIpc(host: HomeIpcHost): void {
  function assertHomePageSender(event: IpcMainInvokeEvent): void {
    if (host.workspaceStartupFailure()) throw host.workspaceStartupFailure()
    const actual = event.senderFrame?.url
    try {
      const url = new URL(actual ?? '')
      if (url.protocol === 'hronaut:' && url.hostname === 'home' && (url.pathname === '/' || url.pathname === '')) return
    } catch {
      // Fall through to the trusted-origin error below.
    }
    throw new Error('Rejected IPC from a non-Home page')
  }

  /** Home's own document, not a frame inside it: for actions that change files outside Hronaut. */
  function assertHomeMainFrame(event: IpcMainInvokeEvent): void {
    assertHomePageSender(event)
    if (!event.senderFrame || event.senderFrame !== event.sender.mainFrame) throw new Error('Rejected IPC from a Home subframe')
  }

  let claudeCodeSetup: ClaudeCodeSetup | null = null
  /** Adds Hronaut to Claude Code's settings after the person confirms the exact change in a native dialog. */
  function claudeCodeSetupService(): ClaudeCodeSetup {
    claudeCodeSetup ??= new ClaudeCodeSetup({
      path: claudeCodeConfigPath(),
      endpoint: () => host.mcpUrl(),
      allowed: () => !host.settings().mcpAuthentication,
      confirm: async (preview) => {
        const { response } = await host.showMessageBox({
          type: 'question',
          title: host.text('native.dialog.claudeSetupTitle'),
          message: host.text('native.dialog.claudeSetupMessage'),
          detail: host.text('native.dialog.claudeSetupDetail', {
            path: preview.path,
            after: preview.after,
            replaces: preview.before === null ? '' : host.text('native.dialog.claudeSetupReplaces', { before: preview.before }),
            backup: preview.backupName
          }),
          buttons: [host.text('native.dialog.cancel'), host.text('native.dialog.claudeSetupConfirm')],
          defaultId: 1,
          cancelId: 0,
          noLink: true
        })
        return response === 1
      }
    })
    return claudeCodeSetup
  }

  function assertClaudeCodeSetupAllowed(): void {
    // Hronaut never writes a token into another app's settings; with authentication on, the copied command is the way.
    if (host.settings().mcpAuthentication) throw new Error('Claude Code setup is unavailable while MCP authentication is enabled. Use the command instead.')
  }

  host.handleBrowserIpc('hronaut-home:workspaces', (event) => {
    assertHomePageSender(event)
    return homeWorkspaceState(host.tabs()!)
  })
  host.handleBrowserIpc('hronaut-home:workspace-action', async (event, input: unknown) => {
    assertHomePageSender(event)
    return runHomeWorkspaceAction(host.tabs()!, input, (request) => {
      host.mainWindow()?.webContents.send('browser:home-workspace-editor', request)
    })
  })
  host.handleBrowserIpc('hronaut-home:copy-text', async (event, value: unknown) => {
    assertHomePageSender(event)
    if (typeof value !== 'string') throw new TypeError('Clipboard text must be a string')
    try {
      await host.copyTextToClipboard(value)
    } catch (error) {
      host.reportClipboardFailure(error)
      throw error
    }
  })
  host.handleBrowserIpc('hronaut-home:open-vscode-install', async (event) => {
    assertHomePageSender(event)
    await openVsCodeMcpInstall({
      endpoint: host.mcpUrl(),
      authenticationEnabled: host.settings().mcpAuthentication,
      openExternal: (url) => host.openExternal(url)
    })
  })
  host.handleBrowserIpc(
    'hronaut-home:open-setup-help',
    setupHelpHandler(assertHomePageSender, (url) => host.openExternal(url))
  )
  host.handleBrowserIpc(
    'hronaut-home:open-setup-feedback',
    setupFeedbackHandler(assertHomePageSender, (url) => host.openExternal(url))
  )
  host.handleBrowserIpc(
    'hronaut-home:open-agent-guide',
    agentGuideHandler(assertHomePageSender, (url) => host.openExternal(url))
  )
  host.handleBrowserIpc('hronaut-home:use-mcp-port', async (event, port: unknown): Promise<McpPortMoveResult> => {
    assertHomeMainFrame(event)
    return host.mcpPortRecovery().move(port)
  })
  host.handleBrowserIpc('hronaut-home:setup-state', async (event): Promise<HomeSetupState> => {
    assertHomeMainFrame(event)
    const setup = claudeCodeSetupService()
    const [detected, claudeCode] = await Promise.all([
      detectAgentClients(undefined, { 'claude-code': [setup.path] }),
      host.settings().mcpAuthentication ? undefined : setup.status()
    ])
    return { detected, ...(claudeCode ? { claudeCode } : {}) }
  })
  host.handleBrowserIpc('hronaut-home:claude-code-prepare', (event) => {
    assertHomeMainFrame(event)
    assertClaudeCodeSetupAllowed()
    return claudeCodeSetupService().prepare(event.sender.id)
  })
  host.handleBrowserIpc('hronaut-home:claude-code-apply', async (event, planId: unknown) => {
    assertHomeMainFrame(event)
    assertClaudeCodeSetupAllowed()
    return claudeCodeSetupService().apply(planId, event.sender.id)
  })
}
