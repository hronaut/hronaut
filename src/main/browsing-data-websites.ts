import type {
  BrowserBookmark,
  BrowserHistoryEntry,
  BrowserTabState,
  BrowsingDataWebsiteSummary,
  CredentialSummary,
  SitePermissionEntry
} from '../shared/types.js'

export interface BrowsingDataCookie {
  domain?: string
  hostOnly?: boolean
  secure?: boolean
  path?: string
}

export interface BrowsingDataWebsiteSources {
  history: BrowserHistoryEntry[]
  cookies: BrowsingDataCookie[]
  bookmarks: BrowserBookmark[]
  credentials: CredentialSummary[]
  permissions: SitePermissionEntry[]
  tabs: BrowserTabState[]
}

function httpOrigin(value: string): string | null {
  try {
    const url = new URL(value)
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.hostname ? url.origin : null
  } catch {
    return null
  }
}

function cookieHostname(cookie: BrowsingDataCookie): string | null {
  const hostname = cookie.domain?.replace(/^\./, '').toLocaleLowerCase()
  if (!hostname || hostname.includes('/') || hostname.includes(' ')) return null
  try {
    const address = hostname.startsWith('[') && hostname.endsWith(']')
      ? hostname
      : hostname.includes(':')
        ? `[${hostname}]`
        : hostname
    return new URL(`http://${address}`).hostname.toLocaleLowerCase()
  } catch {
    return null
  }
}

function cookieOrigin(cookie: BrowsingDataCookie): string | null {
  const hostname = cookieHostname(cookie)
  if (!hostname) return null
  const address = hostname.startsWith('[') ? hostname : hostname.includes(':') ? `[${hostname}]` : hostname
  return `${cookie.secure ? 'https' : 'http'}://${address}`
}

/** Hosts Chromium trusts over plain HTTP, so it sends them Secure cookies: localhost, its subdomains and loopback addresses. */
function loopbackHostname(hostname: string): boolean {
  const host = hostname.endsWith('.') ? hostname.slice(0, -1) : hostname
  return host === 'localhost' || host.endsWith('.localhost') || host === '[::1]' || /^127(?:\.\d{1,3}){3}$/.test(host)
}

/**
 * Whether a request to the origin can match the cookie's path: the origin's address at that path spells it the same
 * way. One with a space, for example, never matches, and Chromium writes `|` in a request path as `%7C`.
 */
function pathReceivedBy(origin: string, path: string): boolean {
  if (path.includes('|')) return false
  try {
    return new URL(`${origin}${path}`).pathname === path
  } catch {
    return false
  }
}

export function cookieAvailableToOrigin(cookie: BrowsingDataCookie, origin: string): boolean {
  const domain = cookieHostname(cookie)
  if (!domain) return false
  const url = new URL(origin)
  const hostname = url.hostname.toLocaleLowerCase()
  if (cookie.secure && url.protocol !== 'https:' && !loopbackHostname(hostname)) return false
  if (hostname !== domain && (cookie.hostOnly || !hostname.endsWith(`.${domain}`))) return false
  return cookie.path === undefined || pathReceivedBy(url.origin, cookie.path)
}

export function buildBrowsingDataWebsiteInventory(sources: BrowsingDataWebsiteSources): BrowsingDataWebsiteSummary[] {
  const websites = new Map<string, BrowsingDataWebsiteSummary>()
  const ensure = (value: string): BrowsingDataWebsiteSummary | null => {
    const origin = httpOrigin(value)
    if (!origin) return null
    const existing = websites.get(origin)
    if (existing) return existing
    const site: BrowsingDataWebsiteSummary = {
      origin,
      hostname: new URL(origin).hostname,
      title: '',
      cookieCount: 0,
      historyEntries: 0,
      historyVisits: 0,
      bookmarkCount: 0,
      savedPasswordCount: 0,
      permissionDecisionCount: 0,
      openTabCount: 0
    }
    websites.set(origin, site)
    return site
  }

  for (const entry of sources.history) {
    const site = ensure(entry.url)
    if (!site) continue
    site.historyEntries += 1
    site.historyVisits += entry.visitCount
    if (!site.lastVisitedAt || entry.visitedAt > site.lastVisitedAt) {
      site.lastVisitedAt = entry.visitedAt
      site.title = entry.title
    }
  }
  for (const bookmark of sources.bookmarks) {
    const site = ensure(bookmark.url)
    if (!site) continue
    site.bookmarkCount += 1
    if (!site.title) site.title = bookmark.title
  }
  for (const credential of sources.credentials) {
    const site = ensure(credential.origin)
    if (site) site.savedPasswordCount += 1
  }
  for (const permission of sources.permissions) {
    const site = ensure(permission.origin)
    if (site) site.permissionDecisionCount += 1
  }
  for (const tab of sources.tabs) {
    const site = ensure(tab.url)
    if (!site) continue
    site.openTabCount += 1
    if (!site.title) site.title = tab.title
  }
  for (const cookie of sources.cookies) {
    const origin = cookieOrigin(cookie)
    if (origin) ensure(origin)
  }

  for (const site of websites.values()) {
    site.cookieCount = sources.cookies.filter((cookie) => cookieAvailableToOrigin(cookie, site.origin)).length
    if (!site.title) site.title = site.hostname
  }

  return [...websites.values()].sort((left, right) => {
    const visited = (right.lastVisitedAt ?? '').localeCompare(left.lastVisitedAt ?? '')
    if (visited) return visited
    const rightActivity = right.cookieCount + right.bookmarkCount + right.savedPasswordCount + right.permissionDecisionCount + right.openTabCount
    const leftActivity = left.cookieCount + left.bookmarkCount + left.savedPasswordCount + left.permissionDecisionCount + left.openTabCount
    return rightActivity - leftActivity || left.hostname.localeCompare(right.hostname) || left.origin.localeCompare(right.origin)
  })
}
