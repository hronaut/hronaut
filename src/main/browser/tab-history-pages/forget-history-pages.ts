import type { Browser } from '../browser.js'
import { publishChange } from '../browser-state/browser-state.js'
import { saveForNextStart } from '../browser-lifecycle/save-for-next-start.js'
import { forgetClosedTabs } from '../tab-reopening/tab-reopening.js'
import { forgetTabHistoryPages } from './forget-tab-history-pages.js'

/**
 * Forgets the pages whose history was cleared or removed, as Chrome does: the recently closed tabs showing them, which
 * Recently closed names, and those pages in the Back and Forward lists of open and closed tabs; only the workspace's
 * tabs when one is named, as when an agent clears a website's history from its workspace.
 */
export function forgetHistoryPages(browser: Browser, matches: (url: string) => boolean, workspaceId?: string): void {
  const closedTabsForgotten = forgetClosedTabs(browser, matches, workspaceId)
  const tabs = [...browser.tabs.values()].filter((tab) => workspaceId === undefined || tab.mcpGroupId === workspaceId)
  const openTabPagesForgotten = forgetTabHistoryPages(tabs, matches)
  if (closedTabsForgotten || openTabPagesForgotten) publishChange(browser, false)
  // The open tabs' history saved before forgets the pages too, for a tab whose history cannot be read when it is saved
  // next and keeps what was saved before. Both are saved without the pages at once; before the saved tabs are back,
  // Recently closed cannot be saved yet, so the saved one goes.
  browser.tabHistoryStore?.forgetPages(matches, workspaceId === undefined ? undefined : new Set(tabs.map((tab) => tab.id)))
  if (!browser.initialized) void browser.closedTabsStore?.discard().catch((error: unknown) => console.error('[browser] Failed to remove recently closed tabs:', error))
  void saveForNextStart(browser, true)
}
