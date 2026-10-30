import type { BrowserState } from '../../../shared/types.js'
import type { Browser } from '../browser.js'
import { forgetTabsOpenedFrom, switchLeavesOpenedTabs } from '../link-tab-placement/link-tab-openers.js'
import { selectTabAndWait } from './tab-selection.js'

/**
 * The person's own switch to a tab. Going to a tab unrelated to the one its workspace shows starts another task, so
 * the workspace forgets which page opened which tab, as Chrome does going from its window's tab. That is also the
 * tab compared when the person comes from another workspace.
 */
export function selectTabForPerson(browser: Browser, tabId: string): Promise<BrowserState> {
  const to = browser.tabs.get(tabId)
  const shownId = to?.mcpGroupId ? browser.mcpTabGroups.get(to.mcpGroupId)?.activeTabId : undefined
  const from = shownId ? browser.tabs.get(shownId) : undefined
  if (from && to && switchLeavesOpenedTabs(from, to)) forgetTabsOpenedFrom(browser.tabs.values(), to.mcpGroupId)
  return selectTabAndWait(browser, tabId)
}
