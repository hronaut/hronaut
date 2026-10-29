import type { Rectangle } from 'electron'
import type { Browser } from '../browser.js'
import { findTab } from '../browser-core.js'
import type { BrowserTab } from '../browser-tab.js'

/** The shortest the shell's toolbar can be, in window pixels. */
const MIN_SHELL_HEIGHT = 44

/** Records the shell's toolbar height, kept between the shortest shell and the window's height, and lays the pages out again. */
export function setToolbarHeight(browser: Browser, height: number): void {
  if (browser.destroyed || browser.window.isDestroyed()) return
  const contentHeight = browser.window.getContentBounds().height
  browser.toolbarHeight = Math.min(
    Math.max(Math.round(height), MIN_SHELL_HEIGHT),
    Math.max(MIN_SHELL_HEIGHT, contentHeight - 1)
  )
  browser.layout()
}

/** Records how far the shell reaches into the window below the toolbar, each inset whole, at least zero and short of the window, and lays the pages out again. */
export function setContentInsets(browser: Browser, insets: { top: number; right: number; bottom: number; left: number }): void {
  if (browser.destroyed || browser.window.isDestroyed()) return
  const bounds = browser.window.getContentBounds()
  const finiteInset = (value: number, maximum: number): number => Math.min(
    Math.max(Math.round(Number.isFinite(value) ? value : 0), 0),
    Math.max(0, maximum)
  )
  browser.contentInsets = {
    top: finiteInset(insets.top, bounds.height - browser.toolbarHeight - 1),
    right: finiteInset(insets.right, bounds.width - 1),
    bottom: finiteInset(insets.bottom, bounds.height - browser.toolbarHeight - 1),
    left: finiteInset(insets.left, bounds.width - 1)
  }
  browser.layout()
}

/** Where pages show, below the toolbar and beside the tab rail, in window coordinates; null once the window is gone. */
export function pageArea(browser: Browser): Rectangle | null {
  if (browser.destroyed || browser.window.isDestroyed()) return null
  return browserViewBounds(browser)
}

/** The tab the window shows whose page is in full screen, such as a video: the active tab or a split view pane. */
export function shownPageFullscreenTab(browser: Browser): BrowserTab | undefined {
  const splitView = browser.splitView
  const shownIds = splitView ? [splitView.firstTabId, splitView.secondTabId] : [browser.activeTabId]
  for (const tabId of shownIds) {
    const tab = tabId ? findTab(browser, tabId) : undefined
    if (tab?.pageFullscreen && !tab.sleeping) return tab
  }
  return undefined
}

/** The space the browser gives the tab views it shows: the page card's, or the whole window for a shown page in full screen. */
export function browserViewBounds(browser: Browser): Rectangle {
  const bounds = browser.window.getContentBounds()
  if (shownPageFullscreenTab(browser)) return { x: 0, y: 0, width: Math.max(1, bounds.width), height: Math.max(1, bounds.height) }
  return contentAreaBounds(browser)
}

/**
 * The space of the page card: the window below the toolbar, inside the shell's insets, at least one pixel each way.
 * A tab the window does not show is sized for it, even while a shown page in full screen fills the window, so the
 * page, such as one an agent works in, keeps the size it has in front.
 */
export function contentAreaBounds(browser: Browser): Rectangle {
  const bounds = browser.window.getContentBounds()
  return {
    x: browser.contentInsets.left,
    y: browser.toolbarHeight + browser.contentInsets.top,
    width: Math.max(1, bounds.width - browser.contentInsets.left - browser.contentInsets.right),
    height: Math.max(1, bounds.height - browser.toolbarHeight - browser.contentInsets.top - browser.contentInsets.bottom)
  }
}
