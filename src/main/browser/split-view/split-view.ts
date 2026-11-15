import type { BrowserState } from '../../../shared/types.js'
import { isBrowserSplitOrientation, normalizeSplitViewRatio, type BrowserSplitOrientation } from '../../../shared/split-view.js'
import { isHronautHomeUrl } from '../url.js'
import type { Browser } from '../browser.js'
import { focusTabOrTrustedChrome } from '../trusted-chrome-focus/trusted-chrome-focus.js'
import { findTab, getTab } from '../browser-core.js'
import { browserState, publishChange } from '../browser-state/browser-state.js'
import { LocalizedError } from '../../localized-error.js'
import { keepKeyboardFromLoadingPane } from './loading-pane-keyboard.js'
import { forgetRestingSplitViews } from './resting-split-views.js'

/**
 * Wakes the active tab and the chosen one, then opens them side by side,
 * unless the person selected another tab, changed the split view or closed
 * either tab meanwhile. Such a newer action wins: this one then returns the
 * state without opening, even when a wake failed. Asking for the split view
 * is itself a selection, so a tab still waking for an earlier one stays out.
 */
export async function openSplitViewAndWait(browser: Browser, tabId: string, options: OpenSplitViewOptions = {}): Promise<BrowserState> {
  const current = getTab(browser)
  const target = getTab(browser, tabId)
  if (current.id === target.id) throw new LocalizedError('appErrors.splitView.sameTab')
  if (isHronautHomeUrl(current.url) || isHronautHomeUrl(target.url)) throw new LocalizedError('appErrors.splitView.home')
  if (current.webContents.isDestroyed()) {
    throw new LocalizedError('appErrors.splitView.currentUnavailable')
  }
  if (target.webContents.isDestroyed()) {
    throw new LocalizedError('appErrors.splitView.selectedUnavailable')
  }
  browser.splitViewGeneration += 1
  browser.tabSelectionGeneration += 1
  const splitGeneration = browser.splitViewGeneration
  const selectionGeneration = browser.tabSelectionGeneration
  const superseded = () => splitGeneration !== browser.splitViewGeneration
    || selectionGeneration !== browser.tabSelectionGeneration
    || browser.activeTabId !== current.id
    || findTab(browser, current.id) !== current
    || findTab(browser, target.id) !== target
  try {
    await Promise.all([
      browser.wakeTab(current.id),
      browser.wakeTab(target.id)
    ])
  } catch (error) {
    if (superseded()) return browserState(browser)
    // The request was still a selection, which the published state shows, such as no longer marking a followed agent.
    publishChange(browser, false)
    throw error
  }
  if (superseded()) return browserState(browser)
  return openSplitView(browser, target.id, options)
}

export interface OpenSplitViewOptions {
  /** The chosen tab was just opened beside the page, such as for a link, and the person keeps reading the page. */
  openedBeside?: boolean
  /**
   * The split's layout, as when a tab closed from it is put back: its orientation, its ratio, and whether the chosen tab
   * is the first pane. Without it the active tab is first, side by side, at half the width.
   */
  layout?: { orientation: BrowserSplitOrientation; ratio: number; chosenFirst: boolean }
}

/**
 * Shows the chosen tab beside the active one, replacing any other split, and
 * wakes either tab that sleeps without waiting for it. Either tab leaves a
 * split view put aside, which ends.
 */
export function openSplitView(browser: Browser, tabId: string, options: OpenSplitViewOptions = {}): BrowserState {
  const current = getTab(browser)
  const target = getTab(browser, tabId)
  if (current.id === target.id) throw new LocalizedError('appErrors.splitView.sameTab')
  if (isHronautHomeUrl(current.url) || isHronautHomeUrl(target.url)) throw new LocalizedError('appErrors.splitView.home')
  // A WebContentsView can outlive its WebContents when Electron or DevTools
  // tears the renderer down independently. Validate both panes before
  // mutating split state; addChildView/setBounds throw native exceptions for
  // a destroyed child and would otherwise leave splitView half-applied.
  if (current.webContents.isDestroyed()) {
    throw new LocalizedError('appErrors.splitView.currentUnavailable')
  }
  if (target.webContents.isDestroyed()) {
    throw new LocalizedError('appErrors.splitView.selectedUnavailable')
  }
  browser.splitViewGeneration += 1
  current.lastActiveAt = performance.now()
  target.lastActiveAt = performance.now()
  if (current.sleeping) void browser.wakeTab(current.id).catch((error) => console.error('[browser] Could not wake split tab:', error))
  if (target.sleeping) void browser.wakeTab(target.id).catch((error) => console.error('[browser] Could not wake split tab:', error))

  if (browser.splitView) {
    for (const visibleTabId of [browser.splitView.firstTabId, browser.splitView.secondTabId]) {
      const visibleTab = findTab(browser, visibleTabId)
      if (visibleTab && visibleTab.id !== current.id && visibleTab.id !== target.id) {
        // It was in view until now, so Memory Saver counts its inactivity from here.
        visibleTab.lastActiveAt = performance.now()
        browser.window.contentView.removeChildView(visibleTab.view)
      }
    }
  }
  forgetRestingSplitViews(browser, current.id, target.id)
  const layout = options.layout
  browser.splitView = {
    firstTabId: layout?.chosenFirst ? target.id : current.id,
    secondTabId: layout?.chosenFirst ? current.id : target.id,
    orientation: layout?.orientation ?? 'vertical',
    ratio: layout ? normalizeSplitViewRatio(layout.ratio) : 0.5
  }
  browser.window.contentView.addChildView(target.view)
  browser.layout()
  focusTabOrTrustedChrome(browser, current)
  if (options.openedBeside) keepKeyboardFromLoadingPane(browser, current, target)
  publishChange(browser)
  return browserState(browser)
}

/** Changes the open split view's orientation or ratio, or swaps its tabs. */
export function updateSplitView(browser: Browser, updates: { orientation?: BrowserSplitOrientation; ratio?: number; swap?: boolean }): BrowserState {
  if (!browser.splitView) throw new LocalizedError('appErrors.splitView.notOpen')
  if (updates.orientation !== undefined && !isBrowserSplitOrientation(updates.orientation)) {
    throw new TypeError('Split orientation must be vertical or horizontal.')
  }
  if (updates.ratio !== undefined && !Number.isFinite(updates.ratio)) throw new TypeError('Split ratio must be a finite number.')
  browser.splitDivider.cancel()
  browser.splitViewGeneration += 1
  if (updates.orientation !== undefined) browser.splitView.orientation = updates.orientation
  if (updates.ratio !== undefined) browser.splitView.ratio = normalizeSplitViewRatio(updates.ratio)
  if (updates.swap) {
    const firstTabId = browser.splitView.firstTabId
    browser.splitView.firstTabId = browser.splitView.secondTabId
    browser.splitView.secondTabId = firstTabId
  }
  browser.layout()
  publishChange(browser)
  return browserState(browser)
}

/** Leaves only the active tab of the split view in view. */
export function closeSplitView(browser: Browser): BrowserState {
  browser.splitViewGeneration += 1
  if (!browser.splitView) return browserState(browser)
  const activeTab = getTab(browser)
  const otherTabId = browser.splitView.firstTabId === activeTab.id
    ? browser.splitView.secondTabId
    : browser.splitView.firstTabId
  const otherTab = findTab(browser, otherTabId)
  if (otherTab) {
    // It was in view until now, so Memory Saver counts its inactivity from here.
    otherTab.lastActiveAt = performance.now()
    browser.window.contentView.removeChildView(otherTab.view)
  }
  browser.splitView = null
  browser.layout()
  focusTabOrTrustedChrome(browser, activeTab)
  publishChange(browser)
  return browserState(browser)
}
