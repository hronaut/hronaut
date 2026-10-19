import type { BrowserState } from '../../../shared/types.js'
import { LocalizedError } from '../../localized-error.js'
import { isHronautHomeUrl } from '../url.js'
import type { TabArrangementAccess, TabArrangementTab } from './tab-arrangement-access.js'

/** Pins or unpins the tab, waking a pinned tab; the pin is undone when that wake fails and nothing changed it since. */
export async function setTabPinned<Tab extends TabArrangementTab>(access: TabArrangementAccess<Tab>, tabId: string, pinned: boolean): Promise<BrowserState> {
  const tab = access.getTab(tabId)
  if (isHronautHomeUrl(tab.url)) throw new LocalizedError('appErrors.tabs.homeNotPinned')
  const previousPinned = tab.pinned
  if (tab.pinned !== pinned) {
    tab.pinned = pinned
    access.changed()
  }
  if (pinned && (tab.sleeping || tab.wakePromise)) {
    try {
      await access.wakeTab(tab.id)
    } catch (error) {
      if (access.tabs().get(tab.id) === tab && tab.pinned === pinned) {
        tab.pinned = previousPinned
        access.changed()
      }
      throw error
    }
  }
  return access.getState()
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
  access.tabs().clear()
  for (const orderedTab of ordered) access.tabs().set(orderedTab.id, orderedTab)
  access.changed()
  return access.getState()
}
