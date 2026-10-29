import type { BrowserState } from '../../../shared/types.js'
import { LocalizedError } from '../../localized-error.js'
import { isHronautHomeUrl } from '../url.js'
import type { Browser } from '../browser.js'
import { getTab, orderedTabs } from '../browser-core.js'
import type { BrowserTab } from '../browser-tab.js'
import { browserState, publishChange } from '../browser-state/browser-state.js'

/**
 * Pins or unpins the tab, waking a pinned tab; the pin is undone when that wake fails and nothing changed it since. As in
 * Chrome, a pinned tab goes after its workspace's other pinned tabs, and an unpinned one before its other tabs.
 */
export async function setTabPinned(browser: Browser, tabId: string, pinned: boolean): Promise<BrowserState> {
  const tab = getTab(browser, tabId)
  if (isHronautHomeUrl(tab.url)) throw new LocalizedError('appErrors.tabs.homeNotPinned')
  const previousPinned = tab.pinned
  const previousOrder = [...browser.tabs.values()]
  if (tab.pinned !== pinned) {
    tab.pinned = pinned
    placeAtPinnedBoundary(browser, tab)
    publishChange(browser)
  }
  const pinnedOrder = [...browser.tabs.values()]
  if (pinned && (tab.sleeping || tab.wakePromise)) {
    try {
      await browser.wakeTab(tab.id)
    } catch (error) {
      // Only a pin this call made is undone; an already pinned tab whose wake fails keeps its pin and place.
      if (previousPinned !== pinned && browser.tabs.get(tab.id) === tab && tab.pinned === pinned) {
        tab.pinned = previousPinned
        // Back where it was, unless tabs opened, closed or moved meanwhile.
        const current = [...browser.tabs.values()]
        if (current.length === pinnedOrder.length && current.every((candidate, index) => pinnedOrder[index] === candidate)) {
          setOrder(browser, previousOrder)
        } else {
          placeAtPinnedBoundary(browser, tab)
        }
        publishChange(browser)
      }
      throw error
    }
  }
  return browserState(browser)
}

/** Puts the tab just after its workspace's pinned tabs: last of them when pinned, first of the others when not. */
function placeAtPinnedBoundary(browser: Browser, tab: BrowserTab): void {
  const ordered = orderedTabs(browser).filter((candidate) => candidate !== tab)
  const workspace = (candidate: BrowserTab) => candidate.mcpGroupId === tab.mcpGroupId && !isHronautHomeUrl(candidate.url)
  const lastPinned = ordered.findLastIndex((candidate) => workspace(candidate) && candidate.pinned)
  const first = ordered.findIndex(workspace)
  ordered.splice(lastPinned >= 0 ? lastPinned + 1 : first >= 0 ? first : ordered.length, 0, tab)
  setOrder(browser, ordered)
}

function setOrder(browser: Browser, ordered: readonly BrowserTab[]): void {
  browser.tabs.clear()
  for (const orderedTab of ordered) browser.tabs.set(orderedTab.id, orderedTab)
}

/** Moves the tab before or after the target tab, within the same workspace and on the same side of the pinned boundary. */
export function reorderTab(browser: Browser, tabId: string, targetTabId: string, placement: 'before' | 'after'): BrowserState {
  const tab = getTab(browser, tabId)
  const target = getTab(browser, targetTabId)
  if (tab.id === target.id) return browserState(browser)
  if (isHronautHomeUrl(tab.url) || isHronautHomeUrl(target.url)) throw new LocalizedError('appErrors.tabs.homeNotReordered')
  if (tab.pinned !== target.pinned) throw new LocalizedError('appErrors.tabs.pinnedBoundary')
  if (tab.mcpGroupId !== target.mcpGroupId) throw new LocalizedError('appErrors.tabs.otherWorkspace')

  const ordered = orderedTabs(browser)
  ordered.splice(ordered.indexOf(tab), 1)
  const targetIndex = ordered.indexOf(target)
  ordered.splice(targetIndex + (placement === 'after' ? 1 : 0), 0, tab)
  setOrder(browser, ordered)
  publishChange(browser)
  return browserState(browser)
}

/**
 * Moves the tabs together, in the order they have, before or after the target tab, as Chrome moves the tabs selected
 * in its tab strip. Each tab moves only within the target's workspace and on its side of the pinned boundary.
 */
export function reorderTabs(browser: Browser, tabIds: readonly string[], targetTabId: string, placement: 'before' | 'after'): BrowserState {
  const target = getTab(browser, targetTabId)
  const moving = new Set([...new Set(tabIds)].map((tabId) => getTab(browser, tabId)))
  if (moving.has(target)) return browserState(browser)
  if (isHronautHomeUrl(target.url) || [...moving].some((tab) => isHronautHomeUrl(tab.url))) throw new LocalizedError('appErrors.tabs.homeNotReordered')
  if ([...moving].some((tab) => tab.pinned !== target.pinned)) throw new LocalizedError('appErrors.tabs.pinnedBoundary')
  if ([...moving].some((tab) => tab.mcpGroupId !== target.mcpGroupId)) throw new LocalizedError('appErrors.tabs.otherWorkspace')

  const ordered = orderedTabs(browser)
  const staying = ordered.filter((tab) => !moving.has(tab))
  staying.splice(staying.indexOf(target) + (placement === 'after' ? 1 : 0), 0, ...ordered.filter((tab) => moving.has(tab)))
  setOrder(browser, staying)
  publishChange(browser)
  return browserState(browser)
}
