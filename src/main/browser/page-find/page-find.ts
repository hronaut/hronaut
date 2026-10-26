import { MAX_FIND_QUERY_LENGTH } from '../../../shared/types.js'
import { LocalizedError } from '../../localized-error.js'
import type { PageFindAccess, PageFindTab } from './page-find-access.js'

/**
 * Finds the query in the tab's page, forward and to the next match unless
 * told otherwise, superseding the page's earlier search, and reports the
 * active match and the match count.
 */
export async function findInPage<Tab extends PageFindTab>(
  access: PageFindAccess<Tab>,
  query: string,
  options: { tabId?: string; forward?: boolean; findNext?: boolean; caseSensitive?: boolean } = {}
): Promise<{ activeMatchOrdinal: number; matches: number }> {
  if (!query || query.length > MAX_FIND_QUERY_LENGTH) throw new LocalizedError('appErrors.page.findQuery')
  const webContents = access.getTab(options.tabId).webContents
  return access.searchPage(webContents, query, {
    forward: options.forward ?? true,
    findNext: options.findNext ?? true,
    matchCase: options.caseSensitive ?? false
  })
}

/**
 * Ends the tab's page search and clears its selection, or, as Chrome's Ctrl+Enter in its find bar does, clicks the
 * active match, which follows the link it is in. A click in the page is the person's input, so a tab whose input is
 * locked only has its search ended.
 */
export function stopFindInPage<Tab extends PageFindTab>(
  access: PageFindAccess<Tab>,
  tabId?: string,
  options: { activateMatch?: boolean } = {}
): void {
  const tab = access.getTab(tabId)
  const activate = options.activateMatch === true && !access.isHumanInteractionLocked(tab)
  access.stopPageSearch(tab.webContents, activate ? 'activateSelection' : 'clearSelection')
}
