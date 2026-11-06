import type { BrowserPageProblem } from '../../../shared/types.js'
import { PAGE_DESTROYED_REASON } from '../../../shared/types/page-problems.js'
import type { NavigationHistorySnapshot } from '../navigation-history.js'
import { normalizeTabTitle } from '../tab-metadata.js'
import { isAddressTitle, untitledPageTitle } from './untitled-page-title.js'

/** The tab's fields its page's own title is told from. */
export interface TabTitleSource {
  title: string
  url: string
  pageProblem?: BrowserPageProblem
}

/**
 * The title a tab is kept by, in Recently closed, the saved session and an archived workspace: its title, unless that
 * names a crash or a failed load, such as Page unavailable. Then it is the page's title in the tab's history, as Chrome
 * keeps it, or else the page's address as Chromium shows an untitled or failed page. The history is read only then.
 */
export function pageOwnTitle(tab: TabTitleSource, history: () => NavigationHistorySnapshot): string {
  if (!tab.pageProblem || !titledByProblem(tab.pageProblem)) return tab.title
  const { entries, index } = history()
  const entry = entries[index]
  const title = entry?.url === tab.url ? entry.title.trim() : ''
  return normalizeTabTitle(title && !isAddressTitle(title, tab.url) ? title : untitledPageTitle(tab.url), tab.url)
}

/**
 * Whether the tab's title names its problem rather than its page: its page crashed or could not load. A refused
 * certificate keeps its Privacy error, as Chrome's interstitial is titled; a page that hangs, or whose contents are gone,
 * keeps its own title.
 */
function titledByProblem(problem: BrowserPageProblem): boolean {
  if (problem.kind === 'load-error') return !problem.certificate
  return problem.kind === 'renderer-gone' && problem.reason !== PAGE_DESTROYED_REASON
}
