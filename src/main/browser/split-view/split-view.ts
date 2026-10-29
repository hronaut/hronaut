import type { WebContents } from 'electron'
import type { BrowserState } from '../../../shared/types.js'
import { isBrowserSplitOrientation, normalizeSplitViewRatio, type BrowserSplitOrientation } from '../../../shared/split-view.js'
import { isHronautHomeUrl } from '../url.js'
import type { Browser } from '../browser.js'
import { focusTabOrTrustedChrome } from '../trusted-chrome-focus/trusted-chrome-focus.js'
import { findTab, getTab } from '../browser-core.js'
import type { BrowserTab } from '../browser-tab.js'
import { browserState, publishChange } from '../browser-state/browser-state.js'
import { LocalizedError } from '../../localized-error.js'

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
  /** The chosen tab was just opened for a link beside the page, which the person keeps reading. */
  openedBeside?: boolean
}

/**
 * Shows the chosen tab beside the active one, replacing any other split, and
 * wakes either tab that sleeps without waiting for it.
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
  current.lastActiveAt = Date.now()
  target.lastActiveAt = Date.now()
  if (current.sleeping) void browser.wakeTab(current.id).catch((error) => console.error('[browser] Could not wake split tab:', error))
  if (target.sleeping) void browser.wakeTab(target.id).catch((error) => console.error('[browser] Could not wake split tab:', error))

  if (browser.splitView) {
    for (const visibleTabId of [browser.splitView.firstTabId, browser.splitView.secondTabId]) {
      const visibleTab = findTab(browser, visibleTabId)
      if (visibleTab && visibleTab.id !== current.id && visibleTab.id !== target.id) {
        // It was in view until now, so Memory Saver counts its inactivity from here.
        visibleTab.lastActiveAt = Date.now()
        browser.window.contentView.removeChildView(visibleTab.view)
      }
    }
  }
  browser.splitView = {
    firstTabId: current.id,
    secondTabId: target.id,
    orientation: 'vertical',
    ratio: 0.5
  }
  browser.window.contentView.addChildView(target.view)
  browser.layout()
  focusTabOrTrustedChrome(browser, current)
  if (options.openedBeside) keepKeyboardFromLoadingPane(browser, current, target)
  publishChange(browser)
  return browserState(browser)
}

// Stops each pane's keyboard guard, so a pane opened beside again keeps a single one.
const keyboardGuards = new WeakMap<WebContents, () => void>()

/**
 * A page still loading its first document, such as a link just opened beside the page, takes the keyboard when its
 * view first shows, though the person is on the other pane. Until that document arrives, the keyboard goes back to
 * the active pane, unless the person or an agent made the loading pane active meanwhile or the split changed.
 */
function keepKeyboardFromLoadingPane(browser: Browser, active: BrowserTab, loading: BrowserTab): void {
  const contents = loading.webContents
  keyboardGuards.get(contents)?.()
  // A new tab's load may not have started yet, so only a page that already shows a document is left alone.
  if (contents.getURL() !== '' && !contents.isLoadingMainFrame()) return
  const generation = browser.splitViewGeneration
  const superseded = (): boolean => browser.splitViewGeneration !== generation || browser.activeTabId !== active.id
    || findTab(browser, active.id) !== active || active.webContents.isDestroyed() || contents.isDestroyed()
  // Chromium can ignore a focus change made from the focus event itself, so it is given back on the next turn.
  const giveBack = (): void => {
    setImmediate(() => {
      if (superseded()) {
        stop()
        return
      }
      if (contents.isFocused()) focusTabOrTrustedChrome(browser, active)
    })
  }
  const stop = (): void => {
    if (keyboardGuards.get(contents) === stop) keyboardGuards.delete(contents)
    contents.off('focus', giveBack)
    contents.off('did-navigate', stop)
    contents.off('did-fail-load', stop)
    contents.off('did-stop-loading', stop)
    contents.off('destroyed', stop)
  }
  keyboardGuards.set(contents, stop)
  contents.on('focus', giveBack)
  contents.on('did-navigate', stop)
  contents.on('did-fail-load', stop)
  contents.on('did-stop-loading', stop)
  contents.on('destroyed', stop)
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
    otherTab.lastActiveAt = Date.now()
    browser.window.contentView.removeChildView(otherTab.view)
  }
  browser.splitView = null
  browser.layout()
  focusTabOrTrustedChrome(browser, activeTab)
  publishChange(browser)
  return browserState(browser)
}
