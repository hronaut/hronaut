import type { BrowserState } from '../../../shared/types.js'
import { LocalizedError } from '../../localized-error.js'
import type { Browser } from '../browser.js'
import { exitPageFullscreenCovering } from '../page-fullscreen/page-fullscreen.js'
import { focusTabOrTrustedChrome } from '../trusted-chrome-focus/trusted-chrome-focus.js'
import { findTab, getTab } from '../browser-core.js'
import type { BrowserTab } from '../browser-tab.js'
import { browserState, publishChange } from '../browser-state/browser-state.js'

/** How a tab is selected. */
export interface BrowserTabSelectionOptions {
  /** Keep an already-visible split pane from claiming keyboard focus. */
  focus?: boolean
}

/**
 * Selects a tab after waking it. A selection made while it wakes, or the tab
 * closing, wins: this one then returns the state without selecting.
 */
export async function selectTabAndWait(browser: Browser, tabId: string, options: BrowserTabSelectionOptions = {}): Promise<BrowserState> {
  const next = getTab(browser, tabId)
  if (next.webContents.isDestroyed()) {
    throw new LocalizedError('appErrors.tabs.rendererUnavailable')
  }
  browser.tabSelectionGeneration += 1
  const selectionGeneration = browser.tabSelectionGeneration
  if (next.sleeping || next.wakePromise) {
    try {
      await browser.wakeTab(next.id)
    } catch (error) {
      if (
        selectionGeneration !== browser.tabSelectionGeneration
        || findTab(browser, next.id) !== next
      ) return browserState(browser)
      throw error
    }
  }
  if (
    selectionGeneration !== browser.tabSelectionGeneration
    || findTab(browser, next.id) !== next
  ) return browserState(browser)
  return selectTab(browser, next.id, options)
}

/**
 * Wakes an agent's tab and makes it its workspace's active tab without
 * showing it. Follow agents shows it through the agent's call on it, so it
 * waits as for any call, such as while a page fills the window. Another
 * active tab in its workspace while it wakes, such as the person's pick, or
 * the tab closing, wins: this one then returns the state without marking it.
 * A selection in another workspace does not stop it.
 */
export async function selectAgentTabAndWait(browser: Browser, tabId: string): Promise<BrowserState> {
  const tab = getTab(browser, tabId)
  if (tab.webContents.isDestroyed()) {
    throw new Error('This tab renderer is no longer available. Close the tab and reopen it from Recently closed.')
  }
  const workspaceActiveTabId = activeTabIdInWorkspace(browser, tab)
  await browser.wakeTab(tabId)
  if (findTab(browser, tabId) !== tab || workspaceActiveTabId !== activeTabIdInWorkspace(browser, tab)) return browserState(browser)
  if (tab.webContents.isDestroyed()) {
    throw new Error('This tab renderer is no longer available. Close the tab and reopen it from Recently closed.')
  }
  browser.markTabActiveInGroup(tab)
  publishChange(browser)
  return browserState(browser)
}

/** The active tab of the tab's workspace, if it has one. */
function activeTabIdInWorkspace(browser: Browser, tab: BrowserTab): string | null | undefined {
  return tab.mcpGroupId ? browser.mcpTabGroups.get(tab.mcpGroupId)?.activeTabId : undefined
}

/**
 * Shows a tab in the window, waking it if it sleeps. A pane of the open split
 * view becomes the active pane, and the other pane in full screen, which hides
 * it, is asked to leave full screen; any other tab replaces the split view or
 * the current tab, which count as active until they leave the window.
 */
export function selectTab(browser: Browser, tabId: string, options: BrowserTabSelectionOptions = {}): BrowserState {
  const next = getTab(browser, tabId)
  if (next.webContents.isDestroyed()) {
    throw new LocalizedError('appErrors.tabs.rendererUnavailable')
  }
  browser.tabSelectionGeneration += 1
  next.lastActiveAt = Date.now()
  if (next.sleeping) void browser.wakeTab(next.id).catch((error) => console.error('[browser] Could not wake selected tab:', error))
  if (browser.splitView && browser.splitViewContains(tabId)) {
    exitPageFullscreenCovering(browser, next.id)
    browser.writeActiveTabId(next.id)
    browser.markTabActiveInGroup(next)
    browser.layout()
    if (options.focus !== false) focusTabOrTrustedChrome(browser, next)
    publishChange(browser)
    return browserState(browser)
  }
  const current = browser.activeTabId ? findTab(browser, browser.activeTabId) : undefined
  // A page leaving the window was in view until now, so Memory Saver counts its inactivity from here.
  if (browser.splitView) {
    for (const visibleTabId of [browser.splitView.firstTabId, browser.splitView.secondTabId]) {
      const visibleTab = findTab(browser, visibleTabId)
      if (visibleTab && visibleTab.id !== next.id) {
        visibleTab.lastActiveAt = Date.now()
        browser.window.contentView.removeChildView(visibleTab.view)
      }
    }
    browser.splitView = null
  } else if (current && current.id !== next.id) {
    current.lastActiveAt = Date.now()
    browser.window.contentView.removeChildView(current.view)
  }
  if (current?.id !== next.id) browser.window.contentView.addChildView(next.view)
  browser.writeActiveTabId(next.id)
  browser.markTabActiveInGroup(next)
  browser.layout()
  if (options.focus !== false) focusTabOrTrustedChrome(browser, next)
  publishChange(browser)
  return browserState(browser)
}
