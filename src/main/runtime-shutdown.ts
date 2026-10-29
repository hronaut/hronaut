import type { AgentServicesState } from './agent-services.js'
import type { BookmarksAndHistoryState } from './bookmarks-history/bookmarks-and-history.js'
import type { BrowserSessionState } from './browser-session.js'
import type { CommercialLicenseRuntimeState } from './license/commercial-license-runtime.js'
import type { CredentialRuntimeState } from './credentials/credential-runtime.js'
import type { McpRuntimeState } from './mcp-runtime/mcp-runtime.js'
import type { SettingsState } from './settings/settings-runtime.js'
import type { TabRuntimeState } from './tab-runtime-startup.js'
import type { UndoOffers } from './undo-offers.js'
import type { WalletRuntimeState } from './wallet/runtime.js'

interface RuntimeShutdownHost {
  /** The tab runtime, whose label edits stop, operations drain and state is flushed; destroyed and cleared last. */
  tabRuntime: Pick<TabRuntimeState, 'tabs'>
  /** The MCP listener, cleared as shutdown starts and stopped first. */
  mcpRuntime: Pick<McpRuntimeState, 'server'>
  /** The wallets, whose broker shuts down once the tab runtime drained; disposed and cleared last. */
  walletRuntime: Pick<WalletRuntimeState, 'service' | 'broker'>
  /** The bookmarks and the visit history, whose files are flushed. */
  bookmarksAndHistory: BookmarksAndHistoryState
  /** The receipts of what agents did in each workspace, which stop before the Undo offers close. */
  agentServices: Pick<AgentServicesState, 'auditReceipts'>
  /** The person's latest reversible action; a workspace closed with Undo still on offer is deleted on closing. */
  undoOffers: Pick<UndoOffers, 'close'>
  /** The password, site permission and license stores, whose files are flushed. */
  credentialRuntime: Pick<CredentialRuntimeState, 'store'>
  browserSessionState: Pick<BrowserSessionState, 'sitePermissionStore'>
  commercialLicenseRuntime: Pick<CommercialLicenseRuntimeState, 'store'>
  /** The settings updates still running, which shutdown waits for. */
  settingsState: Pick<SettingsState, 'mutationQueue'>
  /** Write both windows' last bounds and the browser profile's session data. */
  flushWindowState(): Promise<void>
  flushPanelWindowState(): Promise<void>
  flushBrowserProfile(): Promise<void>
}

/**
 * The runtime's orderly shutdown: the MCP listener stops, agents' receipts stop, the Undo offers close, the tab
 * runtime's workspace operations drain and the wallet broker shuts down, one after another; then every store, both
 * windows' state and the browser profile are flushed together, and the tab runtime and wallets are destroyed. A failed
 * step is logged and the rest still run. Later calls share the first shutdown.
 */
export function createRuntimeShutdown(host: RuntimeShutdownHost): { releaseRuntimeResources(): Promise<void> } {
  let runtimeShutdown: Promise<void> | null = null

  async function releaseRuntimeResources(): Promise<void> {
    if (runtimeShutdown) return runtimeShutdown
    const manager = host.tabRuntime.tabs
    manager?.stopTabLabelEdits()
    const server = host.mcpRuntime.server
    const wallets = host.walletRuntime.service
    const broker = host.walletRuntime.broker
    host.mcpRuntime.server = null
    runtimeShutdown = (async () => {
      // The visits of the last second are saved at once: the steps below can last until the exit is forced. Visits
      // recorded meanwhile are saved with the other stores.
      const history = host.bookmarksAndHistory.history
      const recentVisitsSaved = Promise.allSettled([history?.flush()])
      history?.dispose()
      const results = [
        ...await Promise.allSettled([server?.stop()]),
        ...await Promise.allSettled([host.agentServices.auditReceipts?.stopAll()]),
        // A workspace closed with Undo still on offer is deleted now, and so is one closed while quitting.
        ...await Promise.allSettled([host.undoOffers.close()]),
        ...await Promise.allSettled([manager?.drainWorkspaceOperations()]),
        ...await Promise.allSettled([broker?.shutdown()]),
        ...await Promise.allSettled([
          manager?.flushPersist(),
          manager?.flushWorkspaceProfiles(),
          host.bookmarksAndHistory.bookmarks?.flush(),
          host.credentialRuntime.store?.flush(),
          host.bookmarksAndHistory.history?.flush(),
          host.browserSessionState.sitePermissionStore?.flush(),
          host.commercialLicenseRuntime.store?.flush(),
          host.settingsState.mutationQueue,
          host.flushWindowState(),
          host.flushPanelWindowState(),
          host.flushBrowserProfile()
        ]),
        ...await recentVisitsSaved
      ]
      for (const result of results) {
        if (result.status === 'rejected') console.error('[shutdown] Runtime cleanup failed:', result.reason)
      }
      manager?.destroy()
      wallets?.dispose()
      if (host.tabRuntime.tabs === manager) host.tabRuntime.tabs = null
      if (host.walletRuntime.service === wallets) host.walletRuntime.service = null
      if (host.walletRuntime.broker === broker) host.walletRuntime.broker = null
    })()
    return runtimeShutdown
  }

  return { releaseRuntimeResources }
}
