import type { Browser } from '../browser.js'
import { orderedTabs } from '../browser-core.js'
import { isInFoldedWorkspace } from '../folded-workspaces/folded-workspaces.js'
import type { BrowserTab } from '../browser-tab.js'
import { tabAfterClosingLinkTab } from '../link-tab-placement/link-tab-openers.js'

/** The split partner and the tab that becomes active when this tab closes. */
export function closeTabTransition(browser: Browser, tab: BrowserTab): { splitPartnerId: string | null; nextId: string | undefined } {
  const splitPartnerId = browser.splitViewContains(tab.id)
    ? (browser.splitView!.firstTabId === tab.id ? browser.splitView!.secondTabId : browser.splitView!.firstTabId)
    : null
  const ordered = orderedTabs(browser)
  const ids = ordered.map((candidate) => candidate.id)
  const index = ids.indexOf(tab.id)
  // A popup window, or a page that closes itself as a sign-in window does once it has answered, returns to the page that
  // opened it, as closing Chrome's popup window does. A tab a page opened with window.open follows the tabs that page
  // opened, as any tab opened from a page does, which Chrome forgets once the person turns to another task.
  const returnsToOpener = tab.openedAsWindow === true || tab.closedItself === true
  const openerId = returnsToOpener && tab.openerTabId && browser.tabs.has(tab.openerTabId) ? [tab.openerTabId] : []
  // So does a new tab closed right away, to the tab the person was on.
  const returnId = tab.returnsToTabId && browser.tabs.get(tab.returnsToTabId)?.mcpGroupId === tab.mcpGroupId ? [tab.returnsToTabId] : []
  // A tab opened from a page shows that page's next tab, or the page, as in Chrome.
  const fromPage = tabAfterClosingLinkTab(ordered, tab, (candidate) => !candidate.webContents.isDestroyed())
  const fromPageId = fromPage ? [fromPage.id] : []
  const after = ids.slice(index + 1)
  const before = ids.slice(0, index).reverse()
  // A tab beside it in its own workspace comes first, as Chrome stays in a tab group, so closing the last tab of a
  // workspace's row shows the one to its left rather than a tab of the next workspace.
  const sameWorkspace = (candidateId: string) => browser.tabs.get(candidateId)?.mcpGroupId === tab.mcpGroupId
  const orderedCandidates = splitPartnerId
    ? [splitPartnerId, ...ids]
    : [...openerId, ...returnId, ...fromPageId, ...after.filter(sameWorkspace), ...before.filter(sameWorkspace), ...after, ...before]
  const usable = (candidateId: string): boolean => {
    const candidate = browser.tabs.get(candidateId)
    return candidate !== undefined && candidate.id !== tab.id && !candidate.webContents.isDestroyed()
  }
  // A tab of another workspace the strip folds comes only when no other is left, as Chrome passes over collapsed groups:
  // the strip would unfold it to show it. The person may fold the workspace they are in, whose tabs still come first,
  // as before. A split view keeps its partner.
  const shown = (candidateId: string): boolean => {
    const candidate = browser.tabs.get(candidateId)!
    return splitPartnerId !== null || candidate.mcpGroupId === tab.mcpGroupId || !isInFoldedWorkspace(browser, candidate)
  }
  const nextId = tab.id === browser.activeTabId
    ? orderedCandidates.find((candidateId) => usable(candidateId) && shown(candidateId)) ?? orderedCandidates.find(usable)
    : undefined
  return { splitPartnerId, nextId }
}
