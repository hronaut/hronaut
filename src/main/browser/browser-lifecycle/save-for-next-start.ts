import type { BrowserTab } from '../browser-tab.js'
import type { Browser } from '../browser.js'
import { savedClosedTabs } from '../saved-closed-tabs/saved-closed-tabs.js'
import { type SavedTabHistoryAccess, historyAroundShownPage, savedHistoryPosition, savedTabHistories } from '../saved-tab-history/saved-tab-history.js'
import { withoutSleepingPage } from '../tab-sleep/tab-sleep.js'

/**
 * Saves the tabs' Back and Forward history and Recently closed for the next start, once the saved tabs are back and
 * until the browser closes. A failure is logged: the tabs then restart at their addresses, and Recently closed starts
 * empty. Every few seconds only the histories that moved are read again, and the shown tabs' for their scroll and
 * form state; `everyTab` reads all, as when the browser closes.
 */
export async function saveForNextStart(browser: Browser, everyTab = false): Promise<void> {
  if (!browser.initialized) return
  await Promise.all([
    browser.tabHistoryStore?.save((previous) => browser.destroyed ? undefined : savedTabHistories(savedTabHistoryAccess(browser, everyTab), previous))
      .catch((error: unknown) => console.error('[browser] Failed to save tab history:', error)),
    browser.closedTabsStore?.save(() => browser.destroyed ? undefined : savedClosedTabs(browser))
      .catch((error: unknown) => console.error('[browser] Failed to save recently closed tabs:', error))
  ])
}

/** The narrow view saving the tabs' history gets of the browser's tabs, their history and the workspaces' rules. */
export function savedTabHistoryAccess(browser: Browser, everyTab: boolean): SavedTabHistoryAccess<BrowserTab> {
  return {
    tabs: () => browser.tabs.values(),
    navigationHistory: (tab) => {
      if (tab.sleepNavigationHistory) return tab.sleepNavigationHistory
      if (tab.webContents.isDestroyed()) return undefined
      const history = historyAroundShownPage(tab.webContents.navigationHistory)
      return history && withoutSleepingPage(history)
    },
    unchanged: (tab) => {
      const position = savedHistoryPosition(tab)
      const unchanged = !everyTab && position !== undefined && position === tab.savedHistoryPosition
        // The pages shown change their scroll and form state as people use them, which moves no history.
        && tab.id !== browser.activeTabId && !browser.splitViewContains(tab.id)
      tab.savedHistoryPosition = position
      return unchanged
    },
    navigationPolicy: (workspaceId) => browser.mcpTabGroups.get(workspaceId)?.navigationPolicy
  }
}
