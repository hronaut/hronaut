import type { BrowserState } from '../../../shared/types.js'
import { isHronautHomeUrl } from '../url.js'
import type { NavigationNewTabAccess, NavigationNewTabTab } from './navigation-new-tab-access.js'

/** The page of the tab's history each toolbar button goes to, from the one the tab shows. */
const STEP = { back: -1, reload: 0, forward: 1 } as const

/**
 * Opens the page Back or Forward goes to, or for Reload the page the tab shows, in a new tab beside the tab, with the
 * tab's history, as Chrome does for a middle-click on its toolbar buttons, or a Ctrl+click (⌘-click on a Mac) on Back
 * and Forward. The tab stays on its page. The new tab opens behind unless `active`, in the tab's workspace and under
 * its navigation policy. Nothing opens when the tab has no page that way, or for Hronaut Home.
 */
export async function openNavigationInNewTab<Tab extends NavigationNewTabTab>(access: NavigationNewTabAccess<Tab>, tabId: string,
  target: keyof typeof STEP, active: boolean): Promise<BrowserState> {
  const tab = access.getTab(tabId)
  const { entries, index } = access.navigationHistorySnapshot(tab)
  const targetIndex = index + STEP[target]
  const entry = index < 0 ? undefined : entries[targetIndex]
  if (!entry || isHronautHomeUrl(tab.url) || isHronautHomeUrl(entry.url)) return access.getState()
  await access.createTab({
    url: entry.url,
    title: entry.title,
    // The page was visited already; the history the tab takes with it says so.
    suppressInitialHistory: true,
    active,
    navigationHistory: { entries, index: targetIndex },
    mcpGroupId: tab.mcpGroupId,
    openedFrom: { tabId: tab.id, background: !active }
  })
  return access.getState()
}
