import type { BrowserState } from '../../../shared/types.js'
import { LocalizedError } from '../../localized-error.js'
import { isHronautHomeUrl } from '../url.js'
import type { TabArrangementAccess, TabArrangementTab } from './tab-arrangement-access.js'

/**
 * Pins or unpins the tab, waking a pinned tab; the pin is undone when that wake fails and nothing changed it since. As in
 * Chrome, a pinned tab goes after its workspace's other pinned tabs, and an unpinned one before its other tabs.
 */
export async function setTabPinned<Tab extends TabArrangementTab>(access: TabArrangementAccess<Tab>, tabId: string, pinned: boolean): Promise<BrowserState> {
  const tab = access.getTab(tabId)
  if (isHronautHomeUrl(tab.url)) throw new LocalizedError('appErrors.tabs.homeNotPinned')
  const previousPinned = tab.pinned
  const previousOrder = [...access.tabs().values()]
  if (tab.pinned !== pinned) {
    tab.pinned = pinned
    placeAtPinnedBoundary(access, tab)
    access.changed()
  }
  const pinnedOrder = [...access.tabs().values()]
  if (pinned && (tab.sleeping || tab.wakePromise)) {
    try {
      await access.wakeTab(tab.id)
    } catch (error) {
      // Only a pin this call made is undone; an already pinned tab whose wake fails keeps its pin and place.
      if (previousPinned !== pinned && access.tabs().get(tab.id) === tab && tab.pinned === pinned) {
        tab.pinned = previousPinned
        // Back where it was, unless tabs opened, closed or moved meanwhile.
        const current = [...access.tabs().values()]
        if (current.length === pinnedOrder.length && current.every((candidate, index) => pinnedOrder[index] === candidate)) {
          setOrder(access, previousOrder)
        } else {
          placeAtPinnedBoundary(access, tab)
        }
        access.changed()
      }
      throw error
    }
  }
  return access.getState()
}

/** Puts the tab just after its workspace's pinned tabs: last of them when pinned, first of the others when not. */
function placeAtPinnedBoundary<Tab extends TabArrangementTab>(access: TabArrangementAccess<Tab>, tab: Tab): void {
  const ordered = access.orderedTabs().filter((candidate) => candidate !== tab)
  const workspace = (candidate: Tab) => candidate.mcpGroupId === tab.mcpGroupId && !isHronautHomeUrl(candidate.url)
  const lastPinned = ordered.findLastIndex((candidate) => workspace(candidate) && candidate.pinned)
  const first = ordered.findIndex(workspace)
  ordered.splice(lastPinned >= 0 ? lastPinned + 1 : first >= 0 ? first : ordered.length, 0, tab)
  setOrder(access, ordered)
}

function setOrder<Tab extends TabArrangementTab>(access: TabArrangementAccess<Tab>, ordered: readonly Tab[]): void {
  access.tabs().clear()
  for (const orderedTab of ordered) access.tabs().set(orderedTab.id, orderedTab)
}

/** Moves the tab before or after the target tab, within the same workspace and on the same side of the pinned boundary. */
export function reorderTab<Tab extends TabArrangementTab>(access: TabArrangementAccess<Tab>, tabId: string, targetTabId: string, placement: 'before' | 'after'): BrowserState {
  const tab = access.getTab(tabId)
  const target = access.getTab(targetTabId)
  if (tab.id === target.id) return access.getState()
  if (isHronautHomeUrl(tab.url) || isHronautHomeUrl(target.url)) throw new LocalizedError('appErrors.tabs.homeNotReordered')
  if (tab.pinned !== target.pinned) throw new LocalizedError('appErrors.tabs.pinnedBoundary')
  if (tab.mcpGroupId !== target.mcpGroupId) throw new LocalizedError('appErrors.tabs.otherWorkspace')

  const ordered = access.orderedTabs()
  ordered.splice(ordered.indexOf(tab), 1)
  const targetIndex = ordered.indexOf(target)
  ordered.splice(targetIndex + (placement === 'after' ? 1 : 0), 0, tab)
  setOrder(access, ordered)
  access.changed()
  return access.getState()
}
