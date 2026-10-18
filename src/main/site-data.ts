import type { Session } from 'electron'
import { cookieAvailableToOrigin } from './browsing-data-websites.js'
import type { BrowserTabsManager } from './browser/tabs-manager.js'
import type { HistoryStore } from './history-store.js'
import type { SiteDataOperations, SiteDataType } from './mcp/server.js'
import type { BrowsingDataSiteSummary } from '../shared/types.js'

interface SiteDataHost {
  /** The tab runtime, which clears a workspace's site data between its storage operations; null until the window opens. */
  tabs(): Pick<BrowserTabsManager, 'withWorkspaceSiteDataCleanup' | 'workspaceSession'> | null
  /** The visit history, once loaded; the collection and browsing data IPC, the MCP server and shutdown read it too. */
  historyStore(): Pick<HistoryStore, 'list' | 'clearOrigin'> | null
  publishVisitHistory(): void
}

/**
 * One website's stored data in a browser session: what it holds, as the shell's site summary and agents read it, and
 * clearing chosen kinds of it from one workspace for an agent. `agentSiteData` is what the MCP server offers agents.
 */
export function createSiteData(host: SiteDataHost): {
  currentBrowsingDataSiteSummary(value: string, browserSession: Session | undefined): Promise<BrowsingDataSiteSummary>
  agentSiteData: SiteDataOperations
} {
  async function currentBrowsingDataSiteSummary(
    value: string,
    browserSession: Session | undefined
  ): Promise<BrowsingDataSiteSummary> {
    if (!browserSession) throw new Error('Persistent browser storage is unavailable')
    let url: URL
    try {
      url = new URL(value)
      if ((url.protocol !== 'http:' && url.protocol !== 'https:') || !url.hostname) throw new Error()
    } catch {
      throw new TypeError('Website must be a valid HTTP or HTTPS address')
    }
    const history = (host.historyStore()?.list() ?? []).filter((entry) => new URL(entry.url).origin === url.origin)
    const cookies = (await browserSession.cookies.get({}))
      .filter((cookie) => cookieAvailableToOrigin(cookie, url.origin))
    return {
      origin: url.origin,
      cookieCount: cookies.length,
      historyEntries: history.length,
      historyVisits: history.reduce((total, entry) => total + entry.visitCount, 0)
    }
  }

  async function clearWorkspaceSiteData(
    workspaceId: string,
    value: string,
    dataTypes: SiteDataType[]
  ): Promise<{ origin: string; cleared: SiteDataType[]; remaining: BrowsingDataSiteSummary }> {
    if (!host.tabs() || !host.historyStore()) throw new Error('Workspace browser storage is unavailable')
    const store = host.historyStore()!
    return host.tabs()!.withWorkspaceSiteDataCleanup(workspaceId, async (browserSession) => {
      const site = await currentBrowsingDataSiteSummary(value, browserSession)
      const selected = new Set(dataTypes)
      const originScope = { origins: [site.origin], originMatchingMode: 'origin-in-all-contexts' as const }
      if (selected.has('history')) {
        await store.clearOrigin(site.origin)
        host.publishVisitHistory()
      }
      if (selected.has('cookies-and-storage') && selected.has('cache')) {
        await browserSession.clearData({
          dataTypes: ['backgroundFetch', 'cache', 'cookies', 'fileSystems', 'indexedDB', 'localStorage', 'serviceWorkers', 'webSQL'],
          ...originScope
        })
      } else if (selected.has('cookies-and-storage')) {
        await browserSession.clearData({
          dataTypes: ['backgroundFetch', 'cookies', 'fileSystems', 'indexedDB', 'localStorage', 'serviceWorkers', 'webSQL'],
          ...originScope
        })
        await browserSession.clearStorageData({ storages: ['cachestorage'], origin: site.origin })
      } else if (selected.has('cache')) {
        await browserSession.clearData({ dataTypes: ['cache'], ...originScope })
      }
      return {
        origin: site.origin,
        cleared: dataTypes,
        remaining: await currentBrowsingDataSiteSummary(site.origin, browserSession)
      }
    })
  }

  /** Agents' site data operations, each in the session of the workspace they name. */
  const agentSiteData: SiteDataOperations = {
    inspect: (workspaceId, origin) => currentBrowsingDataSiteSummary(origin, host.tabs()?.workspaceSession(workspaceId)),
    clear: (workspaceId, origin, dataTypes: SiteDataType[]) => clearWorkspaceSiteData(workspaceId, origin, dataTypes)
  }

  return { currentBrowsingDataSiteSummary, agentSiteData }
}
