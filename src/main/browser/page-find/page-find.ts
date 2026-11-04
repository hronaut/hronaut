import type { WebContents } from 'electron'
import { MAX_FIND_QUERY_LENGTH } from '../../../shared/types.js'
import { LocalizedError } from '../../localized-error.js'
import type { Browser } from '../browser.js'
import type { BrowserTab } from '../browser-tab.js'
import { getTab } from '../browser-core.js'
import { ISOLATED_WORLDS } from '../isolated-worlds.js'
import { pageScriptsRunNow } from '../page-script-readiness.js'

/** The document each page's latest search ran in, by its tab's document generation. */
const searchedDocuments = new WeakMap<WebContents, number>()

/** Each page's selection collapsing for a search, which the page's later searches and the search's end follow. */
const collapsing = new WeakMap<WebContents, Promise<void>>()

// Collapses the selection to its start in the frame within the page that has the focus, as far as the page's own frames
// and open shadow roots go, which is where Chromium's search starts, and does nothing else. It runs in a world of its
// own, so the page cannot change what it does.
export const COLLAPSE_SELECTION_SCRIPT = `(() => {
  let frame = document
  let focused = frame.activeElement
  for (;;) {
    if (focused?.contentDocument) {
      frame = focused.contentDocument
      focused = frame.activeElement
    } else if (focused?.shadowRoot?.activeElement) {
      focused = focused.shadowRoot.activeElement
    } else {
      break
    }
  }
  const selection = frame.getSelection()
  if (selection?.rangeCount) selection.collapseToStart()
})()`

// How long a search waits for the page to answer that it collapsed its selection. The script is on its way to the
// page by then, ahead of the search, so a page busy with its own work runs it first, and Find only stops waiting.
const COLLAPSE_SELECTION_WAIT_MS = 300

/**
 * Finds the query in the tab's page, forward and to the next match unless
 * told otherwise, superseding the page's earlier search, and reports the
 * active match and the match count. A new search in Chromium skips a selected
 * match it starts from, so it goes on to the next one; fromSelectionStart
 * collapses the selection first, so a selected match is found itself, as
 * Chrome finds the match its find bar closed on when it opens again.
 */
export async function findInPage(
  browser: Browser,
  query: string,
  options: { tabId?: string; forward?: boolean; findNext?: boolean; caseSensitive?: boolean; fromSelectionStart?: boolean } = {}
): Promise<{ activeMatchOrdinal: number; matches: number }> {
  if (!query || query.length > MAX_FIND_QUERY_LENGTH) throw new LocalizedError('appErrors.page.findQuery')
  const tab = getTab(browser, options.tabId)
  const webContents = tab.webContents
  const earlier = collapsing.get(webContents)
  const fromSelection = options.fromSelectionStart === true && pageScriptsRunNow(webContents)
  if (fromSelection) {
    // Chrome finds the selected match itself by collapsing its search's starting point to the start, which Electron's
    // search cannot ask for, so the page's selection is collapsed to its start.
    const collapsed = (earlier ?? Promise.resolve()).then(() => collapseSelectionToStart(webContents))
    collapsing.set(webContents, collapsed)
    await collapsed
    if (collapsing.get(webContents) === collapsed) collapsing.delete(webContents)
  } else if (earlier) {
    // A search asked for meanwhile, such as Enter pressed as Find opens, follows the one the page collapses its
    // selection for, as in Chrome, which sends that one at once.
    await earlier
  }
  if (webContents.isDestroyed()) throw new Error('Page search was cancelled or superseded')
  searchedDocuments.set(webContents, tab.documentGeneration)
  return browser.pageFind.search(webContents, query, {
    forward: options.forward ?? true,
    findNext: options.findNext ?? true,
    matchCase: options.caseSensitive ?? false
  }, fromSelection)
}

async function collapseSelectionToStart(page: WebContents): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const waited = new Promise<void>((resolve) => { timer = setTimeout(resolve, COLLAPSE_SELECTION_WAIT_MS) })
  const collapsed = page.executeJavaScriptInIsolatedWorld(ISOLATED_WORLDS.findFromSelection, [{ code: COLLAPSE_SELECTION_SCRIPT }])
    .then(() => undefined, () => undefined)
  await Promise.race([collapsed, waited])
  clearTimeout(timer)
}

/**
 * Ends the tab's page search. As Chrome's find bar does when it closes, the active match stays selected, and the link
 * it is in takes the page's focus, so Enter then follows it; emptying the Find field clears the selection instead. As
 * Chrome's Ctrl+Enter in its find bar does, it can also click the active match, which follows the link it is in.
 * Selecting and clicking the match act in the page as the person's input, so, as the person's Back key does, they leave
 * alone a page behind trusted chrome, a locked tab, a page an agent is sending input to and a page with an area capture
 * or element pick in progress: those only have their search ended and its selection cleared. Ending it on the match,
 * selected or clicked, counts as the person's interaction with the tab, as their own click in the page does, also when
 * the match is outside a link and Chromium only selects it, or a search still answering may not have one: one
 * interaction too many is the safe side.
 */
export function stopFindInPage(
  browser: Browser,
  tabId?: string,
  options: { activateMatch?: boolean; clearSelection?: boolean } = {}
): void {
  const tab = getTab(browser, tabId)
  // Ended while the page collapses its selection for Find opening again, the search ends once it went to the page, so
  // the match it finds there is the one kept, as in Chrome, which sends that search at once.
  const pending = collapsing.get(tab.webContents)
  if (pending) {
    void pending.then(() => {
      if (!tab.webContents.isDestroyed() && browser.tabs.get(tab.id) === tab) endSearch(browser, tab, options)
    })
    return
  }
  endSearch(browser, tab, options)
}

function endSearch(browser: Browser, tab: BrowserTab, options: { activateMatch?: boolean; clearSelection?: boolean }): void {
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
  // On a replaced document the match is gone with the document it was in.
  if (!browser.pageFind.stop(tab.webContents, endingAction(replaced, personsPage, options)) || replaced) return
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
