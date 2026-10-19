import type { IpcMain, IpcMainInvokeEvent, Session } from 'electron'
import { rememberedSitePermissions } from './browser-session.js'
import { buildBrowsingDataWebsiteInventory } from './browsing-data-websites.js'
import type { BookmarkStore } from './bookmark-store.js'
import type { BrowserTabsManager } from './browser/tabs-manager.js'
import type { CredentialStore } from './credential-store.js'
import type { HistoryStore } from './history-store.js'
import type { McpHttpServer } from './mcp/server.js'
import type { SitePermissionStore } from './site-permission-store.js'
import type {
  BrowsingDataClearOptions,
  BrowsingDataSiteSummary,
  BrowsingDataSummary,
  BrowsingDataWebsiteSummary
} from '../shared/types.js'

interface BrowsingDataIpcHost {
  assertTrustedSender(event: IpcMainInvokeEvent): void
  /** Registers a handler that is refused while saved workspaces are still initializing or failed to start. */
  handleBrowserIpc(channel: string, listener: Parameters<IpcMain['handle']>[1]): void
  tabs(): Pick<BrowserTabsManager, 'getState' | 'workspaceSession'> | null
  historyStore(): Pick<HistoryStore, 'list' | 'clearOrigin' | 'clear'> | null
  bookmarkStore(): Pick<BookmarkStore, 'list'> | null
  credentialStore(): Pick<CredentialStore, 'list'> | null
  sitePermissionStore(): Pick<SitePermissionStore, 'list'> | null
  mcpServer(): Pick<McpHttpServer, 'forgetHomeFeed'> | null
  publishVisitHistory(): void
  currentBrowsingDataSiteSummary(value: string, browserSession: Session | undefined): Promise<BrowsingDataSiteSummary>
}

function normalizeBrowsingDataOrigin(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  try {
    const url = new URL(value)
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || !url.hostname) throw new Error()
    return url.origin
  } catch {
    throw new TypeError('Browsing data website must be a valid HTTP or HTTPS origin')
  }
}

/** Dependencies stay lazy because handlers are registered before the window loads. */
export function registerBrowsingDataIpc(host: BrowsingDataIpcHost): void {
  async function currentBrowsingDataSummary(): Promise<BrowsingDataSummary> {
    const history = host.historyStore()?.list() ?? []
    return {
      historyEntries: history.length,
      historyVisits: history.reduce((total, entry) => total + entry.visitCount, 0),
      bookmarkCount: host.bookmarkStore()?.list().length ?? 0,
      savedPasswordCount: host.credentialStore()?.list().length ?? 0,
      permissionDecisionCount: rememberedSitePermissions(host.sitePermissionStore()?.list() ?? []).length
    }
  }

  async function currentBrowsingDataWebsites(): Promise<BrowsingDataWebsiteSummary[]> {
    const browserState = host.tabs()?.getState()
    return buildBrowsingDataWebsiteInventory({
      history: host.historyStore()?.list() ?? [],
      cookies: [],
      bookmarks: host.bookmarkStore()?.list() ?? [],
      credentials: host.credentialStore()?.list() ?? [],
      permissions: rememberedSitePermissions(host.sitePermissionStore()?.list() ?? []),
      tabs: browserState?.tabs ?? []
    })
  }

  async function clearBrowsingData(options: BrowsingDataClearOptions): Promise<BrowsingDataSummary> {
    if (!host.historyStore()) throw new Error('Browser history is unavailable')
    if (!options.history) throw new Error('Select history to clear')
    const origin = normalizeBrowsingDataOrigin(options.origin)
    if (origin) await host.historyStore()!.clearOrigin(origin)
    else await host.historyStore()!.clear()
    // Home's feed names pages agents acted on, so it goes with any history clearing.
    host.mcpServer()?.forgetHomeFeed()
    host.publishVisitHistory()
    return currentBrowsingDataSummary()
  }

  host.handleBrowserIpc('browsing-data:summary', (event) => {
    host.assertTrustedSender(event)
    return currentBrowsingDataSummary()
  })
  host.handleBrowserIpc('browsing-data:site-summary', (event, url: unknown, tabId: unknown) => {
    host.assertTrustedSender(event)
    if (typeof url !== 'string') throw new TypeError('Invalid website')
    if (typeof tabId !== 'string') throw new TypeError('Tab ID is required')
    const tab = host.tabs()?.getState().tabs.find((candidate) => candidate.id === tabId)
    if (!tab) throw new Error(`Tab not found: ${tabId}`)
    if (!tab.mcpGroupId) throw new Error('Website workspace is required')
    const browserSession = host.tabs()?.workspaceSession(tab.mcpGroupId)
    return host.currentBrowsingDataSiteSummary(url, browserSession)
  })
  host.handleBrowserIpc('browsing-data:websites', (event) => {
    host.assertTrustedSender(event)
    return currentBrowsingDataWebsites()
  })
  host.handleBrowserIpc('browsing-data:clear', (event, value: unknown) => {
    host.assertTrustedSender(event)
    if (!value || typeof value !== 'object') throw new TypeError('Invalid browsing-data options')
    const { history, origin } = value as Record<string, unknown>
    if (typeof history !== 'boolean' || (origin !== undefined && typeof origin !== 'string')
      || Object.keys(value).some(key => key !== 'history' && key !== 'origin')) throw new TypeError('Invalid history clearing options')
    return clearBrowsingData({ history, ...(origin ? { origin } : {}) })
  })
}
