import type { BrowserState } from '../../../shared/types.js'
import { LocalizedError } from '../../localized-error.js'
import type { Browser } from '../browser.js'
import { exitPageFullscreenCovering } from '../page-fullscreen/page-fullscreen.js'
import { focusTabOrTrustedChrome, returnTabFieldFocus, shellHasKeyboard, shellTabFieldWithKeyboard } from '../trusted-chrome-focus/trusted-chrome-focus.js'
import { findTab, getTab } from '../browser-core.js'
import type { BrowserTab } from '../browser-tab.js'
import { browserState, publishChange } from '../browser-state/browser-state.js'
import { markTabActiveInGroup, writeActiveTabId } from './active-tab.js'

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
    notePickedField(browser)
    try {
      await browser.wakeTab(next.id)
    } catch (error) {
      if (
        selectionGeneration !== browser.tabSelectionGeneration
        || findTab(browser, next.id) !== next
      ) return browserState(browser)
      browser.fieldAsPicked = undefined
      throw error
    }
  }
  if (selectionGeneration !== browser.tabSelectionGeneration) return browserState(browser)
  if (findTab(browser, next.id) !== next) {
    browser.fieldAsPicked = undefined
    return browserState(browser)
  }
  return selectTab(browser, next.id, options)
}

/**
 * Notes the field that has the keyboard as the person picks a tab that has to wake first, for the tab shown to keep
 * when the picked tab is shown. A click on the picked tab's row gives the field up as soon as the click is over, so a
 * second pick of a tab still waking, such as a double click, keeps the field the first one noted.
 */
function notePickedField(browser: Browser): void {
  const field = shellTabFieldWithKeyboard(browser)
  const shownId = browser.activeTabId
  if (field && shownId) browser.fieldAsPicked = { tabId: shownId, field }
  else if (browser.fieldAsPicked?.tabId !== shownId) browser.fieldAsPicked = undefined
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
  markTabActiveInGroup(browser, tab)
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
  const picked = browser.fieldAsPicked
  browser.fieldAsPicked = undefined
  next.lastActiveAt = performance.now()
  if (next.sleeping) void browser.wakeTab(next.id).catch((error) => console.error('[browser] Could not wake selected tab:', error))
  if (browser.splitView && browser.splitViewContains(tabId)) {
    // A pane gives its page the keyboard, so the field it was left with is out of date.
    next.fieldFocusOnReturn = undefined
    exitPageFullscreenCovering(browser, next.id)
    writeActiveTabId(browser, next.id)
    markTabActiveInGroup(browser, next)
    browser.layout()
    if (options.focus !== false) focusTabOrTrustedChrome(browser, next)
    publishChange(browser)
    return browserState(browser)
  }
  const current = browser.activeTabId ? findTab(browser, browser.activeTabId) : undefined
  // The tab left keeps its field that has the keyboard, for when it is shown again, or the field that had it as the
  // person picked a tab that woke first, while the shell still has the keyboard.
  if (current && current.id !== next.id) {
    const fieldAsPicked = picked?.tabId === current.id && shellHasKeyboard(browser) ? picked.field : undefined
    current.fieldFocusOnReturn = shellTabFieldWithKeyboard(browser) ?? fieldAsPicked
  }
  // A page leaving the window was in view until now, so Memory Saver counts its inactivity from here.
  if (browser.splitView) {
    for (const visibleTabId of [browser.splitView.firstTabId, browser.splitView.secondTabId]) {
      const visibleTab = findTab(browser, visibleTabId)
      if (visibleTab && visibleTab.id !== next.id) {
        visibleTab.lastActiveAt = performance.now()
        browser.window.contentView.removeChildView(visibleTab.view)
      }
    }
    browser.splitView = null
  } else if (current && current.id !== next.id) {
    current.lastActiveAt = performance.now()
    browser.window.contentView.removeChildView(current.view)
  }
  if (current?.id !== next.id) browser.window.contentView.addChildView(next.view)
  writeActiveTabId(browser, next.id)
  markTabActiveInGroup(browser, next)
  browser.layout()
  // The field the tab was left with comes back only as the tab is shown again, never when it is selected once more.
  const fieldReturned = options.focus !== false && current?.id !== next.id && returnTabFieldFocus(browser, next)
  if (options.focus !== false && !fieldReturned) focusTabOrTrustedChrome(browser, next)
  next.fieldFocusOnReturn = undefined
  publishChange(browser)
  return browserState(browser)
}
