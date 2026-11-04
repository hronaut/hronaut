import type { WebContents } from 'electron'
import { MAX_FIND_QUERY_LENGTH } from '../../../shared/types.js'
import { LocalizedError } from '../../localized-error.js'
import type { Browser } from '../browser.js'
import { getTab } from '../browser-core.js'

/** The document each page's latest search ran in, by its tab's document generation. */
const searchedDocuments = new WeakMap<WebContents, number>()

/**
 * Finds the query in the tab's page, forward and to the next match unless
 * told otherwise, superseding the page's earlier search, and reports the
 * active match and the match count.
 */
export async function findInPage(
  browser: Browser,
  query: string,
  options: { tabId?: string; forward?: boolean; findNext?: boolean; caseSensitive?: boolean } = {}
): Promise<{ activeMatchOrdinal: number; matches: number }> {
  if (!query || query.length > MAX_FIND_QUERY_LENGTH) throw new LocalizedError('appErrors.page.findQuery')
  const tab = getTab(browser, options.tabId)
  const webContents = tab.webContents
  searchedDocuments.set(webContents, tab.documentGeneration)
  return browser.pageFind.search(webContents, query, {
    forward: options.forward ?? true,
    findNext: options.findNext ?? true,
    matchCase: options.caseSensitive ?? false
  })
}

/**
 * Ends the tab's page search. As Chrome's find bar does when it closes, the active match stays selected, and the link
 * it is in takes the page's focus, so Enter then follows it; emptying the Find field clears the selection instead. As
 * Chrome's Ctrl+Enter in its find bar does, it can also click the active match, which follows the link it is in.
 * Selecting and clicking the match act in the page as the person's input, so, as the person's Back key does, they leave
 * alone a page behind trusted chrome, a locked tab, a page an agent is sending input to and a page with an area capture
 * or element pick in progress: those only have their search ended and its selection cleared. Ending it on the match
 * counts as the person's interaction with the tab, as their own click in the page does, also when the match is outside
 * a link and Chromium only selects it: one interaction too many is the safe side.
 */
export function stopFindInPage(
  browser: Browser,
  tabId?: string,
  options: { activateMatch?: boolean; clearSelection?: boolean } = {}
): void {
  const tab = getTab(browser, tabId)
  // Find closes once another document replaces the one it searched, which leaves nothing of the search on the page.
  // Clearing the selection then would clear the new page's own, such as one a page coming back from Back kept, so the
  // selection is kept, as Chrome does.
  const searched = searchedDocuments.get(tab.webContents)
  searchedDocuments.delete(tab.webContents)
  const replaced = searched !== undefined && searched !== tab.documentGeneration
  const personsPage = !browser.browserContentOccluded
    && !browser.isHumanInteractionLocked(tab)
    && !browser.agentInputWebContents.has(tab.webContents.id)
    && !browser.screenshotAreaSessions.has(tab.webContents.id)
    && !browser.elementPickerSessions.has(tab.webContents.id)
  if (!browser.pageFind.stop(tab.webContents, endingAction(replaced, personsPage, options))) return
  tab.humanInteractionGeneration += 1
  tab.lastHumanInteractionAt = performance.now()
  tab.lastActiveAt = tab.lastHumanInteractionAt
  browser.mcpActivityFollower.noteHumanInput()
  browser.options.onUserInteraction?.({ tabId: tab.id, workspaceId: tab.mcpGroupId })
}

/** What ending the search does in the page, as stopFindInPage describes. */
function endingAction(
  replaced: boolean,
  personsPage: boolean,
  options: { activateMatch?: boolean; clearSelection?: boolean }
): 'clearSelection' | 'keepSelection' | 'activateSelection' {
  if (replaced) return 'keepSelection'
  if (!personsPage || options.clearSelection === true) return 'clearSelection'
  return options.activateMatch === true ? 'activateSelection' : 'keepSelection'
}
