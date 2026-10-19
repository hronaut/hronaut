import { MAX_FIND_QUERY_LENGTH } from '../../../shared/types.js'
import { LocalizedError } from '../../localized-error.js'
import type { PageFindAccess } from './page-find-access.js'

/**
 * Finds the query in the tab's page, forward and to the next match unless
 * told otherwise, superseding the page's earlier search, and reports the
 * active match and the match count.
 */
export async function findInPage(
  access: PageFindAccess,
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

/** Ends the tab's page search and clears its selection. */
export function stopFindInPage(access: PageFindAccess, tabId?: string): void {
  access.stopPageSearch(access.getTab(tabId).webContents)
}
