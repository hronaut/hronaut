import type { BrowserState, NewTabOptions } from '../../../shared/types.js'
import type { Browser } from '../browser.js'
import { createNewTab } from './new-tabs.js'

/**
 * Opens an agent's tab, which becomes its workspace's active tab without
 * being shown. Follow agents shows it through the agent's call on it, so it
 * waits as for any call, such as while a page fills the window. `onCreated`
 * learns the tab's id as soon as it exists, since other tabs can open
 * before this call settles.
 */
export async function newAgentTab(browser: Browser, options: NewTabOptions, onCreated?: (tabId: string) => void): Promise<BrowserState> {
  return createNewTab(browser, options, false, onCreated && ((tab) => onCreated(tab.id)))
}

/** Opens a tab for the person. */
export async function newTab(browser: Browser, options: NewTabOptions = {}, selectVisible = true): Promise<BrowserState> {
  // A new tab the person opens with + or Ctrl/Cmd+T returns to the tab they were on when they close it right away, as
  // in Chrome. A tab opened at an address, such as a bookmark's, closes as any tab.
  const shown = selectVisible && options.active !== false && !options.url && browser.activeTabId
    ? browser.tabs.get(browser.activeTabId)
    : undefined
  return createNewTab(browser, options, selectVisible, shown?.mcpGroupId ? (tab) => {
    if (tab.mcpGroupId === shown.mcpGroupId && tab.id !== shown.id) tab.returnsToTabId = shown.id
  } : undefined)
}
