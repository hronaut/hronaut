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
 * active match, which follows the link it is in. A click in the page is the person's input, so, as the person's Back
 * key does, it leaves alone a page behind trusted chrome, a locked tab, a page an agent is sending input to and a page
 * with an area capture or element pick in progress: those only have their search ended. A click counts as the person's
 * interaction with the tab, as their own click in the page does.
 */
export function stopFindInPage<Tab extends PageFindTab>(
  access: PageFindAccess<Tab>,
  tabId?: string,
  options: { activateMatch?: boolean } = {}
): void {
  const tab = access.getTab(tabId)
  const activate = options.activateMatch === true
    && !access.browserContentOccluded()
    && !access.isHumanInteractionLocked(tab)
    && !access.agentInputWebContents().has(tab.webContents.id)
    && !access.nativeSelectionUnderWay(tab.webContents.id)
  if (!access.stopPageSearch(tab.webContents, activate ? 'activateSelection' : 'clearSelection')) return
  tab.humanInteractionGeneration += 1
  tab.lastHumanInteractionAt = Date.now()
  tab.lastActiveAt = tab.lastHumanInteractionAt
  access.noteHumanInput()
  access.onUserInteraction({ tabId: tab.id, workspaceId: tab.mcpGroupId })
}
