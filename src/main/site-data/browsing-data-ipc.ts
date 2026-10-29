import type { IpcMain, IpcMainInvokeEvent, Session } from 'electron'
import { buildBrowsingDataWebsiteInventory } from './browsing-data-websites.js'
import { LocalizedError } from '../localized-error.js'
import type { BookmarkStore } from '../bookmarks-history/bookmark-store.js'
import type { Browser } from '../browser/browser.js'
import type { CredentialStore } from '../credentials/credential-store.js'
import { isSourceViewUrl } from '../browser/source-view-guard.js'
import { normalizeHistoryUrl, type HistoryStore } from '../bookmarks-history/history-store.js'
import type { McpHttpServer } from '../mcp/server.js'
import type { SitePermissionStore } from './site-permission-store.js'
import {
  HISTORY_TIME_RANGES,
  type BrowsingDataClearOptions,
  type BrowsingDataSiteSummary,
  type BrowsingDataSummary,
  type BrowsingDataWebsiteSummary,
  type HistoryTimeRange
} from '../../shared/types.js'

const HOUR_MS = 60 * 60 * 1000
const TIME_RANGE_MS: Record<Exclude<HistoryTimeRange, 'allTime'>, number> = {
  lastHour: HOUR_MS,
  last24Hours: 24 * HOUR_MS,
  last7Days: 7 * 24 * HOUR_MS,
  last4Weeks: 28 * 24 * HOUR_MS
}

interface BrowsingDataIpcHost {
  assertTrustedSender(event: IpcMainInvokeEvent): void
  /** Registers a handler that is refused while saved workspaces are still initializing or failed to start. */
  handleBrowserIpc(channel: string, listener: Parameters<IpcMain['handle']>[1]): void
  tabs(): Pick<Browser, 'getState' | 'workspaceSession' | 'forgetHistoryPages'> | null
  historyStore(): Pick<HistoryStore, 'list' | 'clearOrigin' | 'clearSince' | 'clear'> | null
  bookmarkStore(): Pick<BookmarkStore, 'list'> | null
  credentialStore(): Pick<CredentialStore, 'list'> | null
  sitePermissionStore(): Pick<SitePermissionStore, 'list'> | null
  mcpServer(): Pick<McpHttpServer, 'forgetAgentStepsSince'> | null
  publishVisitHistory(): void
  currentBrowsingDataSiteSummary(value: string, browserSession: Session | undefined): Promise<BrowsingDataSiteSummary>
}

function closedTabOrigin(url: string): string | undefined {
  try {
    return new URL(url).origin
  } catch {
    return undefined
  }
}

/** The address the history keeps for a page in a tab's history, or null for one it cannot hold; a page's source is the page's. */
function tabHistoryAddress(url: string): string | null {
  return normalizeHistoryUrl(isSourceViewUrl(url) ? url.slice('view-source:'.length) : url)
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
      permissionDecisionCount: host.sitePermissionStore()?.list().length ?? 0
    }
  }

  async function currentBrowsingDataWebsites(): Promise<BrowsingDataWebsiteSummary[]> {
    const browserState = host.tabs()?.getState()
    return buildBrowsingDataWebsiteInventory({
      history: host.historyStore()?.list() ?? [],
      cookies: [],
      bookmarks: host.bookmarkStore()?.list() ?? [],
      credentials: host.credentialStore()?.list() ?? [],
      permissions: host.sitePermissionStore()?.list() ?? [],
      tabs: browserState?.tabs ?? []
    })
  }

  async function clearBrowsingData(options: BrowsingDataClearOptions): Promise<BrowsingDataSummary> {
    if (!host.historyStore()) throw new Error('Browser history is unavailable')
    if (!options.history) throw new Error('Select history to clear')
    const origin = normalizeBrowsingDataOrigin(options.origin)
    if (options.timeRange && options.timeRange !== 'allTime') {
      const duration = TIME_RANGE_MS[options.timeRange]
      if (!duration) throw new TypeError('Invalid history time range')
      // As Chrome's time ranges: the visits from then, the steps agents took from then (in Home's feed and in each agent's
      // "All steps", pictures included), and the pages visited then in Recently closed and in tabs' Back and Forward lists.
      const since = Date.now() - duration
      const cleared = new Set(await host.historyStore()!.clearSince(since))
      host.mcpServer()?.forgetAgentStepsSince(since)
      // Electron gives a tab's pages no visit times, so those lists keep only the pages the history shows a visit to from
      // before then and none from then: a page the history cannot hold, such as a page's source or a file, or one left
      // before it was ready, which the history never got, goes too.
      const held = new Set(host.historyStore()!.list().map((entry) => entry.url))
      host.tabs()?.forgetHistoryPages((url) => {
        const address = tabHistoryAddress(url)
        return address === null || cleared.has(address) || !held.has(address)
      })
      host.publishVisitHistory()
      return currentBrowsingDataSummary()
    }
    if (origin) await host.historyStore()!.clearOrigin(origin)
    else await host.historyStore()!.clear()
    // Agents' finished steps name and picture pages they acted on, so Home's feed and each agent's "All steps" go with any
    // history clearing. The cleared website's pages in Recently closed and in tabs' Back and Forward lists go too, as
    // Chrome forgets them with the history.
    host.mcpServer()?.forgetAgentStepsSince()
    host.tabs()?.forgetHistoryPages((url) => !origin || closedTabOrigin(url) === origin)
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
    if (!tab) throw new LocalizedError('native.errors.tabUnavailable', undefined, { message: `Tab not found: ${tabId}` })
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
    const { history, origin, timeRange } = value as Record<string, unknown>
    if (typeof history !== 'boolean' || (origin !== undefined && typeof origin !== 'string')
      || (timeRange !== undefined && !HISTORY_TIME_RANGES.includes(timeRange as HistoryTimeRange))
      // A website's history is cleared for all time, as in Chrome.
      || (origin !== undefined && timeRange !== undefined && timeRange !== 'allTime')
      || Object.keys(value).some(key => key !== 'history' && key !== 'origin' && key !== 'timeRange')) throw new TypeError('Invalid history clearing options')
    return clearBrowsingData({ history, ...(origin ? { origin } : {}), ...(timeRange ? { timeRange: timeRange as HistoryTimeRange } : {}) })
  })
}
