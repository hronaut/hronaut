import type { Session } from 'electron'
import { cookieAvailableToOrigin } from './browsing-data-websites.js'
import { keepSessionCookies } from '../browser/session-cookies/saved-session-cookies.js'
import type { Browser } from '../browser/browser.js'
import type { HistoryStore } from '../bookmarks-history/history-store.js'
import type { SiteDataOperations, SiteDataType } from '../mcp/server.js'
import type { BrowsingDataSiteSummary } from '../../shared/types.js'

function closedTabOrigin(url: string): string | undefined {
  try {
    return new URL(url).origin
  } catch {
    return undefined
  }
}

interface SiteDataHost {
  /** The tab runtime, which clears a workspace's site data between its storage operations; null until the window opens. */
  tabs(): Pick<Browser, 'withWorkspaceSiteDataCleanup' | 'workspaceSession' | 'forgetHistoryPages'> | null
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

  /**
   * Removes the cookies the origin receives, the ones its summary counts. Chromium clears cookies by origin for the whole
   * registrable domain, such as every subdomain of example.com, and with them cached HTTP sign-ins, so they are removed
   * one name at a time, through the origin's own address at the cookie's path, which only cookies the origin receives
   * are sent to.
   */
  async function removeOriginCookies(browserSession: Session, origin: string): Promise<void> {
    const cookies = (await browserSession.cookies.get({})).filter((cookie) => cookieAvailableToOrigin(cookie, origin))
    for (const cookie of cookies) await browserSession.cookies.remove(`${origin}${cookie.path || '/'}`, cookie.name)
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
        // The website's pages in the workspace's Recently closed tabs and in its tabs' Back and Forward lists go with its
        // history, as in Chrome; other workspaces' tabs are not the agent's to change.
        host.tabs()?.forgetHistoryPages((url) => closedTabOrigin(url) === site.origin, workspaceId)
        host.publishVisitHistory()
      }
      if (selected.has('cookies-and-storage') && selected.has('cache')) {
        await browserSession.clearData({
          dataTypes: ['backgroundFetch', 'cache', 'fileSystems', 'indexedDB', 'localStorage', 'serviceWorkers', 'webSQL'],
          ...originScope
        })
        await removeOriginCookies(browserSession, site.origin)
      } else if (selected.has('cookies-and-storage')) {
        await browserSession.clearData({
          dataTypes: ['backgroundFetch', 'fileSystems', 'indexedDB', 'localStorage', 'serviceWorkers', 'webSQL'],
          ...originScope
        })
        await browserSession.clearStorageData({ storages: ['cachestorage'], origin: site.origin })
        await removeOriginCookies(browserSession, site.origin)
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
    inspect: async (workspaceId, origin) => {
      const browserSession = host.tabs()?.workspaceSession(workspaceId)
      // A workspace without tabs has its saved session cookies back first, as the sites it shows would.
      await keepSessionCookies(browserSession)
      return currentBrowsingDataSiteSummary(origin, browserSession)
    },
    clear: (workspaceId, origin, dataTypes: SiteDataType[]) => clearWorkspaceSiteData(workspaceId, origin, dataTypes)
  }

  return { currentBrowsingDataSiteSummary, agentSiteData }
}
