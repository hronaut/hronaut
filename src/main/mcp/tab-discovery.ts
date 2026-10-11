import { MAX_BROWSER_TABS, MAX_BROWSER_TAB_ID_CHARS, type BrowserTabState } from '../../shared/types.js'
import { redactNetworkUrl } from '../../shared/network-details.js'

export const TAB_DISCOVERY_LIMITS = {
  queryChars: 256, titleChars: 160, urlChars: 512, sourceUrlChars: 8192,
  results: 20, outputChars: 16000
} as const

export interface TabDiscoverySearch { query?: string; limit?: number }
type DiscoveryTab = Pick<BrowserTabState, 'id' | 'title' | 'url'>

/** Project before matching: omitted URL components cannot influence discovery. */
export function compactTabDiscovery(tabs: readonly DiscoveryTab[], search: TabDiscoverySearch) {
  const query = search.query ?? ''
  const limit = search.limit ?? 10
  if (typeof query !== 'string' || query.length > TAB_DISCOVERY_LIMITS.queryChars
    || !Number.isInteger(limit) || limit < 1 || limit > TAB_DISCOVERY_LIMITS.results) {
    throw new Error('Invalid compact tab search bounds')
  }
  if (tabs.length > MAX_BROWSER_TABS || tabs.some(tab => tab.id.length > MAX_BROWSER_TAB_ID_CHARS)) {
    throw new Error('Tab discovery exceeds supported tab bounds')
  }
  const projected: DiscoveryTab[] = []
  let projectionTruncated = false
  for (const tab of tabs) {
    if (tab.url.length > TAB_DISCOVERY_LIMITS.sourceUrlChars) continue
    let url: URL
    try { url = new URL(tab.url) } catch { continue }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') continue
    url.username = ''
    url.password = ''
    const address = redactNetworkUrl(url.href)
    projectionTruncated ||= tab.title.length > TAB_DISCOVERY_LIMITS.titleChars || address.length > TAB_DISCOVERY_LIMITS.urlChars
    projected.push({
      id: tab.id,
      title: Array.from(tab.title.slice(0, TAB_DISCOVERY_LIMITS.titleChars), character => {
        const code = character.charCodeAt(0)
        return code < 32 || code === 127 ? ' ' : character
      }).join(''),
      url: address.slice(0, TAB_DISCOVERY_LIMITS.urlChars)
    })
  }
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
  const matches = projected.filter(tab => {
    const fields = [tab.title.toLowerCase(), tab.url.toLowerCase()]
    return terms.every(term => fields.some(field => field.includes(term)))
  })
  const report = {
    scope: 'live-http-tabs-in-workspace',
    tabs: [] as DiscoveryTab[], eligible: projected.length, matching: matches.length,
    returned: 0, truncated: matches.length > 0, projectionTruncated,
    limits: TAB_DISCOVERY_LIMITS,
    caveats: [
      'Counts and matches cover only projected fields of live HTTP(S) tabs with parseable addresses within the source URL bound; other tabs are omitted.',
      'Titles and URL paths may contain private information. This is output minimization, not DLP.',
      'This is point-in-time discovery, not authority for a later action. Recheck the target before acting.'
    ]
  }
  for (const tab of matches.slice(0, limit)) {
    report.tabs.push(tab)
    report.returned = report.tabs.length
    report.truncated = report.returned < report.matching
    if (JSON.stringify(report, null, 2).length > TAB_DISCOVERY_LIMITS.outputChars) {
      report.tabs.pop()
      report.returned = report.tabs.length
      report.truncated = true
      break
    }
  }
  return report
}
