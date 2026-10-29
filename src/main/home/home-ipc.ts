import type { BrowserWindow, IpcMain, IpcMainInvokeEvent } from 'electron'
import { homeWorkspaceState, runHomeWorkspaceAction } from './home-workspace-actions.js'
import { openVsCodeMcpInstall } from '../vscode-mcp-install.js'
import { ClaudeCodeSetup, claudeCodeConfigPath } from '../claude-code-setup.js'
import { detectAgentClients } from '../agent-client-detection.js'
import { agentGuideHandler, setupFeedbackHandler, setupHelpHandler } from '../setup-feedback-links.js'
import type { McpPortRecovery } from '../mcp-port-suggestion.js'
import type { McpTokenConfiguration } from '../mcp-token-store.js'
import type { TrustedDialogOptions } from '../trusted-dialogs/trusted-dialogs.js'
import type { HomeSetupState } from '../../shared/claude-code-setup.js'
import type { MessageKey, MessageParameters } from '../../shared/i18n.js'
import type { AppSettings, McpPortMoveResult } from '../../shared/types.js'

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
  /** The token MCP clients send while authentication is on; undefined before the MCP runtime has loaded it. */
  mcpTokenConfiguration(): Pick<McpTokenConfiguration, 'token' | 'source'> | undefined
  /** Whether the listener takes this bearer credential instead of the token, as an active capability profile's. */
  mcpCredentialAccepted(bearer: string): boolean
  openExternal(url: string): Promise<void>
  mcpPortRecovery(): Pick<McpPortRecovery, 'move'>
  /**
   * Asks in Hronaut's own dialog on the main window, which only the shell answers, never Home; the system dialog when
   * the window cannot show it.
   */
  showDialog(options: Omit<TrustedDialogOptions, 'window'>): Promise<{ response: number }>
  /** Gives the keyboard back to the page that asked, once the shell's dialog took it. */
  focusAskingPage(event: IpcMainInvokeEvent): void
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
  /**
   * Adds Hronaut to Claude Code's settings after the person confirms the exact change in a dialog main asks, which Home
   * cannot answer for them.
   */
  function claudeCodeSetupService(): ClaudeCodeSetup {
    claudeCodeSetup ??= new ClaudeCodeSetup({
      path: claudeCodeConfigPath(),
      endpoint: () => host.mcpUrl(),
      credential: () => {
        if (!host.settings().mcpAuthentication) return undefined
        const configuration = host.mcpTokenConfiguration()
        // An entry without the token could not connect while authentication is on.
        if (!configuration) throw new Error('The MCP token is not loaded yet')
        return { token: configuration.token, accepts: (bearer) => host.mcpCredentialAccepted(bearer) }
      },
      allowed: claudeCodeSetupAllowed,
      confirm: async (preview, signal) => {
        const { response } = await host.showDialog({
          type: 'question',
          title: host.text('native.dialog.claudeSetupTitle'),
          message: host.text('native.dialog.claudeSetupMessage'),
          detail: host.text('native.dialog.claudeSetupDetail', {
            path: preview.path,
            after: preview.after,
            token: preview.tokenHidden ? host.text('native.dialog.claudeSetupToken') : '',
            replaces: preview.before === null ? '' : host.text('native.dialog.claudeSetupReplaces', { before: preview.before }),
            backup: preview.backupName
          }),
          buttons: [host.text('native.dialog.cancel'), host.text('native.dialog.claudeSetupConfirm')],
          // Enter, or a key still held from Home, keeps the file as it is; the change takes a deliberate choice.
          defaultId: 0,
          cancelId: 0,
          primaryId: 1,
          noLink: true,
          ...(signal ? { signal } : {}),
          variant: {
            kind: 'claude-setup',
            path: preview.path,
            after: preview.after,
            before: preview.before,
            tokenHidden: preview.tokenHidden,
            backupName: preview.backupName
          }
        })
        return response === 1 && !signal?.aborted
      }
    })
    return claudeCodeSetup
  }

  /**
   * A token given to this launch only, with HRONAUT_MCP_TOKEN, is the person's to manage: Hronaut does not save it, so
   * it does not write it into Claude Code's settings either, and the copied command is the way.
   */
  function claudeCodeSetupAllowed(): boolean {
    if (!host.settings().mcpAuthentication) return true
    return host.mcpTokenConfiguration()?.source === 'profile'
  }

  function assertClaudeCodeSetupAllowed(): void {
    if (!claudeCodeSetupAllowed()) throw new Error('Claude Code setup is unavailable while the MCP token comes from HRONAUT_MCP_TOKEN. Use the command instead.')
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
      claudeCodeSetupAllowed() ? setup.status() : undefined
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
    // Home going away while the dialog asks, such as its tab closing, takes the question with it and writes nothing.
    const closed = new AbortController()
    const close = (): void => closed.abort()
    event.sender.once('destroyed', close)
    try {
      return await claudeCodeSetupService().apply(planId, event.sender.id, closed.signal)
    } finally {
      event.sender.removeListener('destroyed', close)
      // The dialog is drawn by the shell, which took the keyboard from Home; Home's own focus goes back with it.
      host.focusAskingPage(event)
    }
  })
}
