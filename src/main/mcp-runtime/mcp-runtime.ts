import { stageMcpRuntimeCandidate, synchronizeMcpRuntimeCandidate } from './mcp-runtime-candidate.js'
import { DEFAULT_MCP_TOOL_SET } from '../../shared/mcp-tool-sets.js'
import { mcpLocalHost } from '../../shared/mcp-network.js'
import { DEFAULT_MCP_PORT, isValidMcpPort } from '../../shared/mcp-port.js'
import type { Browser } from '../browser/browser.js'
import type { McpPauseState } from './mcp-pause-state.js'
import type { McpPortRecovery } from './mcp-port-suggestion.js'
import type { McpHttpServer } from '../mcp/server.js'
import type { McpTokenConfiguration } from './mcp-token-store.js'
import type { TrustedDialogOptions } from '../trusted-dialogs/trusted-dialogs.js'
import type { MessageKey, MessageParameters } from '../../shared/i18n.js'
import { LocalizedError } from '../localized-error.js'
import type { AppSettings, McpControlState, McpServerStatus } from '../../shared/types.js'

/**
 * The MCP listener's runtime state, created once by index.ts. Startup and port changes replace the server and its
 * address together; every reader reads the fields when it runs, so it always sees the current listener.
 */
export interface McpRuntimeState {
  /** The address the listener binds: a loopback host, or every interface when settings allow remote access. */
  host: string
  /** The running MCP server; null before startup and after shutdown, and replaced when the port changes. */
  server: McpHttpServer | null
  /** The port the listener uses, from settings or HRONAUT_MCP_PORT. */
  port: number
  /** The endpoint agents connect to, which Home, setup and the tab runtime show. */
  url: string
  /** Whether the listener is starting, ready or failed to start. */
  status: Exclude<McpServerStatus, 'paused'>
  /** Why the listener failed to start, until it listens. */
  startupError: string | undefined
  /** The bearer token and the file it is saved in, once loaded at startup. */
  tokenConfiguration: McpTokenConfiguration | null
}

interface McpRuntimeHost {
  /** The listener's state, which index.ts creates; Home, settings, agent presence and shutdown read it too. */
  state: McpRuntimeState
  /** Builds a server for the port with the browser, stores and agent callbacks it serves; it does not listen yet. */
  createServer(port: number, authenticationEnabled?: boolean): McpHttpServer
  /** The person's lasting pause and the temporary pauses, which a new listener takes over. */
  mcpPauseState: Pick<McpPauseState, 'paused' | 'temporarilyPaused'>
  /** Why the listener could not start on its port and the free port to offer; Home and Settings use it too. */
  mcpPortRecovery: Pick<McpPortRecovery, 'failure' | 'signal' | 'move' | 'record' | 'clear'>
  /** The current settings; read on every use because each committed update replaces them. */
  settings(): AppSettings
  /** The settings as saved, without the overrides from the environment; read on every use for the same reason. */
  persistedSettings(): AppSettings
  updateSettings(updates: Partial<AppSettings>): Promise<AppSettings>
  publishSettings(): void
  publishMcpControlState(options?: { refreshHome?: boolean }): McpControlState
  /** Reloads a visible Home after a committed change; settings changes use it too. */
  refreshHomeAfterCommittedChange(scope: 'mcp' | 'settings'): void
  /** Refuses a change while saved workspaces are still initializing or failed to start. */
  assertWorkspaceInitialized(): void
  /** The tab runtime, which shows pages the current endpoint; null until the window opens. */
  tabs(): Pick<Browser, 'setMcpUrl'> | null
  /** Translates into the current interface language; read on every use because the language can change. */
  text(key: MessageKey, parameters?: MessageParameters): string
  /** Asks in Hronaut's own dialog over the main window's pages, or in the system dialog while that window cannot show it. */
  showDialog(options: Omit<TrustedDialogOptions, 'window'>): Promise<{ response: number }>
}

/**
 * The MCP listener's lifecycle after the window opens: starting it on the configured port, with the startup dialog
 * when it cannot, moving it to another port, and resetting its settings. A new listener is staged paused and becomes
 * the current one only after it listens and its settings are saved, so a failure leaves the running one in place.
 */
export function createMcpRuntime(host: McpRuntimeHost): {
  startMcpServer(): Promise<void>
  setMcpPort(port: number): Promise<AppSettings>
  resetMcpSettings(): Promise<AppSettings>
} {
  /**
   * The startup dialog for a listener that could not start. A busy or refused port offers the free one; if that was taken
   * meanwhile, the dialog comes back with the next offer. It closes itself once the listener starts from Home or Settings.
   */
  async function showMcpStartupFailure(): Promise<void> {
    for (let attempt = 0; attempt < 3 && host.state.status === 'error'; attempt++) {
      const failure = host.mcpPortRecovery.failure
      const problem = failure && failure.code !== 'other' ? failure : undefined
      const signal = host.mcpPortRecovery.signal
      const { response } = await host.showDialog({
        type: 'error',
        title: host.text('native.dialog.mcpFailedTitle'),
        message: problem
          ? host.text(problem.code === 'port-in-use' ? 'native.dialog.mcpPortInUseMessage' : 'native.dialog.mcpPortDeniedMessage', { port: problem.port })
          : host.text('native.dialog.mcpFailedMessage', { host: host.state.host, port: host.state.port }),
        detail: problem
          ? (problem.suggestedPort ? host.text('native.dialog.mcpPortSuggestion', { port: problem.suggestedPort }) : host.text('native.dialog.mcpPortNoneFree'))
          : host.state.startupError,
        signal,
        variant: { kind: 'message', topic: 'agent-connection' },
        ...(problem?.suggestedPort ? {
          buttons: [host.text('native.dialog.notNow'), host.text('native.dialog.mcpUsePort', { port: problem.suggestedPort })],
          defaultId: 1,
          cancelId: 0,
          primaryId: 1,
          noLink: true
        } : { buttons: [host.text('native.dialog.confirmOk')] })
      })
      // A port the person changed meanwhile, from Home or Settings, wins over this older answer.
      if (signal.aborted || response !== 1 || !problem?.suggestedPort || host.mcpPortRecovery.failure !== failure) return
      const result = await host.mcpPortRecovery.move(problem.suggestedPort)
      if (result.outcome === 'failed') {
        await host.showDialog({
          type: 'error',
          title: host.text('native.dialog.mcpFailedTitle'),
          message: host.text('native.dialog.mcpFailedMessage', { host: host.state.host, port: result.port }),
          buttons: [host.text('native.dialog.confirmOk')],
          variant: { kind: 'message', topic: 'agent-connection' }
        })
      }
      if (result.outcome !== 'taken') return
    }
  }

  async function startMcpServer(): Promise<void> {
    host.state.server = host.createServer(host.state.port)
    host.state.server.setPaused(host.mcpPauseState.paused, !host.mcpPauseState.temporarilyPaused)
    try {
      const url = await host.state.server.start()
      host.state.status = 'ready'
      host.state.startupError = undefined
      host.mcpPortRecovery.clear()
      // Listener status is polled by Home; startup changes no bootstrap settings.
      // Reloading here races module initialization and discards early setup input.
      host.publishMcpControlState({ refreshHome: false })
      console.log(`[mcp] Hronaut listening at ${url}`)
    } catch (error) {
      host.state.status = 'error'
      host.state.startupError = error instanceof Error ? error.message : String(error)
      await host.mcpPortRecovery.record(error, host.state.port)
      host.publishMcpControlState({ refreshHome: false })
      console.error('[mcp] Failed to start:', error)
      await showMcpStartupFailure()
    }
  }

  /**
   * Why the listener could not start on a port, keeping Node's text in the message logs read. A port another app uses
   * or the system refuses gets a sentence a person can act on; any other reason keeps Node's words. Moving the port
   * keeps Node's error as the cause, which the port suggestion reads.
   */
  function listenFailure(port: number, error: unknown, cause: boolean): Error {
    const message = `Could not listen on ${host.state.host}:${port}: ${error instanceof Error ? error.message : String(error)}`
    const code = (error as NodeJS.ErrnoException | undefined)?.code
    const key: MessageKey | undefined = code === 'EADDRINUSE' ? 'appErrors.settings.mcpPortInUse'
      : code === 'EACCES' || code === 'EPERM' ? 'appErrors.settings.mcpPortDenied'
        : undefined
    const options = cause ? { cause: error } : undefined
    if (!key) return new Error(message, options)
    return new LocalizedError(key, { host: host.state.host, port }, { message, ...options })
  }

  async function setMcpPort(port: number): Promise<AppSettings> {
    host.assertWorkspaceInitialized()
    if (!isValidMcpPort(port)) throw new LocalizedError('appErrors.settings.mcpPortRange')
    if (port === host.state.port && host.state.status === 'ready') {
      if (host.persistedSettings().mcpPort !== port) await host.updateSettings({ mcpPort: port })
      return { ...host.settings() }
    }

    const candidate = host.createServer(port)
    stageMcpRuntimeCandidate(candidate)
    try {
      await candidate.start()
    } catch (error) {
      await candidate.stop().catch(() => undefined)
      throw listenFailure(port, error, true)
    }

    try {
      await host.updateSettings({ mcpPort: port })
    } catch (error) {
      await candidate.stop().catch(() => undefined)
      throw error
    }

    synchronizeMcpRuntimeCandidate(candidate, () => ({
      paused: host.mcpPauseState.paused,
      allowTabPauseOverrides: !host.mcpPauseState.temporarilyPaused,
      authenticationToken: host.settings().mcpAuthentication ? host.state.tokenConfiguration?.token : undefined
    }))
    const previous = host.state.server
    host.state.server = candidate
    host.state.port = port
    host.state.url = `http://${mcpLocalHost(host.state.host)}:${port}/mcp`
    host.state.status = 'ready'
    host.state.startupError = undefined
    host.mcpPortRecovery.clear()
    host.tabs()?.setMcpUrl(host.state.url)
    host.publishSettings()
    host.publishMcpControlState()
    await previous?.stop().catch((error) => console.error('[mcp] Failed to stop previous listener:', error))
    console.info(`[mcp] Moved listener to ${host.state.url}`)
    return { ...host.settings() }
  }

  async function resetMcpSettings(): Promise<AppSettings> {
    host.assertWorkspaceInitialized()
    // Authentication is on by default, so a reset never turns it off, also while a listener is still open to other
    // computers until a restart. Saved on, it is left out of the save and keeps this launch's override of it, if any.
    const authenticationReset: Partial<AppSettings> = host.persistedSettings().mcpAuthentication ? {} : { mcpAuthentication: true }
    if (host.state.port === DEFAULT_MCP_PORT && host.state.status === 'ready') {
      await host.updateSettings({
        mcpRemoteAccess: false,
        ...authenticationReset,
        mcpPort: DEFAULT_MCP_PORT,
        mcpToolSet: DEFAULT_MCP_TOOL_SET,
        challengeDetectionEnabled: false,
        omitAgentUrlDetail: false
      })
      host.state.server?.setAuthenticationToken(host.settings().mcpAuthentication ? host.state.tokenConfiguration?.token : undefined)
      host.state.server?.setToolSet(DEFAULT_MCP_TOOL_SET)
      host.publishSettings()
      host.refreshHomeAfterCommittedChange('mcp')
      console.info('[mcp] Settings reset; remote-access changes apply after restart.')
      return { ...host.settings() }
    }

    // Keep the candidate listener paused until both reset settings have
    // committed. A bind or persistence failure therefore leaves the current
    // runtime and settings untouched instead of applying half of the reset.
    const candidate = host.createServer(DEFAULT_MCP_PORT, host.settings().mcpAuthentication)
    stageMcpRuntimeCandidate(candidate)
    try {
      await candidate.start()
    } catch (error) {
      await candidate.stop().catch(() => undefined)
      throw listenFailure(DEFAULT_MCP_PORT, error, false)
    }

    try {
      await host.updateSettings({
        mcpRemoteAccess: false,
        ...authenticationReset,
        mcpPort: DEFAULT_MCP_PORT,
        mcpToolSet: DEFAULT_MCP_TOOL_SET,
        challengeDetectionEnabled: false,
        omitAgentUrlDetail: false
      })
    } catch (error) {
      await candidate.stop().catch(() => undefined)
      throw error
    }

    synchronizeMcpRuntimeCandidate(candidate, () => ({
      paused: host.mcpPauseState.paused,
      allowTabPauseOverrides: !host.mcpPauseState.temporarilyPaused,
      authenticationToken: host.settings().mcpAuthentication ? host.state.tokenConfiguration?.token : undefined
    }))
    const previous = host.state.server
    candidate.setToolSet(DEFAULT_MCP_TOOL_SET)
    host.state.server = candidate
    host.state.port = DEFAULT_MCP_PORT
    host.state.url = `http://${mcpLocalHost(host.state.host)}:${DEFAULT_MCP_PORT}/mcp`
    host.state.status = 'ready'
    host.state.startupError = undefined
    host.mcpPortRecovery.clear()
    host.tabs()?.setMcpUrl(host.state.url)
    host.publishSettings()
    host.publishMcpControlState()
    await previous?.stop().catch((error) => console.error('[mcp] Failed to stop previous listener:', error))
    console.info(`[mcp] Reset listener to ${host.state.url}`)
    console.info('[mcp] Settings reset; remote-access changes apply after restart.')
    return { ...host.settings() }
  }

  return { startMcpServer, setMcpPort, resetMcpSettings }
}
