import { MAX_FIND_QUERY_LENGTH } from '../../../shared/types.js'
import { LocalizedError } from '../../localized-error.js'
import type { Browser } from '../browser.js'
import { getTab } from '../browser-core.js'

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
  const webContents = getTab(browser, options.tabId).webContents
  return browser.pageFind.search(webContents, query, {
    forward: options.forward ?? true,
    findNext: options.findNext ?? true,
    matchCase: options.caseSensitive ?? false
  })
}

/**
 * Ends the tab's page search and clears its selection, or, as Chrome's Ctrl+Enter in its find bar does, clicks the
 * active match, which follows the link it is in. A click in the page is the person's input, so, as the person's Back
 * key does, it leaves alone a page behind trusted chrome, a locked tab, a page an agent is sending input to and a page
 * with an area capture or element pick in progress: those only have their search ended. Ending it on the match counts
 * as the person's interaction with the tab, as their own click in the page does, also when the match is outside a link
 * and Chromium only selects it: one interaction too many is the safe side.
 */
export function stopFindInPage(
  browser: Browser,
  tabId?: string,
  options: { activateMatch?: boolean } = {}
): void {
  const tab = getTab(browser, tabId)
  const activate = options.activateMatch === true
    && !browser.browserContentOccluded
    && !browser.isHumanInteractionLocked(tab)
    && !browser.agentInputWebContents.has(tab.webContents.id)
    && !browser.screenshotAreaSessions.has(tab.webContents.id)
    && !browser.elementPickerSessions.has(tab.webContents.id)
  if (!browser.pageFind.stop(tab.webContents, activate ? 'activateSelection' : 'clearSelection')) return
  tab.humanInteractionGeneration += 1
  tab.lastHumanInteractionAt = Date.now()
  tab.lastActiveAt = tab.lastHumanInteractionAt
  browser.mcpActivityFollower.noteHumanInput()
  browser.options.onUserInteraction?.({ tabId: tab.id, workspaceId: tab.mcpGroupId })
}
