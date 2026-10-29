import type { Browser } from '../browser.js'
import { findTab } from '../browser-core.js'
import type { BrowserTab } from '../browser-tab.js'
import { publishPageGeometry } from '../page-geometry/page-geometry.js'
import { focusTabOrTrustedChrome } from '../trusted-chrome-focus/trusted-chrome-focus.js'
import { contentAreaBounds } from '../window-layout/content-area.js'
import { roundPageCorners } from '../window-layout/window-layout.js'

/**
 * Takes the closing page out of view while its beforeunload handler runs: the
 * replacement page, if any, is shown in its place. Cleanup removes a
 * replacement the person did not keep selected; rollback also brings the
 * page back when its close was prevented or failed, and gives it the keyboard
 * when focusPage and it is the active tab.
 */
export function stageBeforeUnloadClose(browser: Browser, tab: BrowserTab): {
  targetDetached: boolean
  cleanup: () => void
  rollback: (focusPage: boolean) => void
} {
  const wasActive = tab.id === browser.activeTabId
  const splitPartnerId = browser.splitViewContains(tab.id)
    ? (browser.splitView!.firstTabId === tab.id ? browser.splitView!.secondTabId : browser.splitView!.firstTabId)
    : null
  if (!wasActive && !splitPartnerId) {
    return { targetDetached: false, cleanup: () => undefined, rollback: () => undefined }
  }

  const bounds = tab.view.getBounds()
  const visible = tab.view.getVisible()
  const nextId = browser.closeTabTransition(tab).nextId
  const replacement = wasActive && !splitPartnerId && nextId
    ? findTab(browser, nextId)
    : undefined
  let replacementWasAttached = false
  browser.window.contentView.removeChildView(tab.view)
  try {
    if (replacement && !replacement.webContents.isDestroyed()) {
      browser.window.contentView.addChildView(replacement.view)
      replacementWasAttached = true
      // The closing tab's bounds can be sized for its own emulated viewport, or fill the window in full screen.
      replacement.view.setBounds(browser.tabViewBounds(replacement, contentAreaBounds(browser)))
      roundPageCorners(browser, replacement.view)
      replacement.view.setVisible(visible)
    }
  } catch (error) {
    if (replacementWasAttached && replacement && !replacement.webContents.isDestroyed()) {
      browser.window.contentView.removeChildView(replacement.view)
    }
    if (!tab.webContents.isDestroyed()) {
      browser.window.contentView.addChildView(tab.view)
      tab.view.setBounds(bounds)
      tab.view.setVisible(visible)
    }
    throw error
  }
  // The closing tab's frame and caption leave with its page.
  publishPageGeometry(browser)

  const cleanup = (): void => {
    // A user can select another page while Chromium runs beforeunload.
    // Restore only the views owned by the current selection, not the
    // selection that existed when the close probe started.
    if (
      replacementWasAttached && replacement && !replacement.webContents.isDestroyed()
      && browser.activeTabId !== replacement.id && !browser.splitViewContains(replacement.id)
    ) {
      browser.window.contentView.removeChildView(replacement.view)
      replacementWasAttached = false
    }
  }
  return {
    targetDetached: true,
    cleanup,
    rollback: (focusPage) => {
      cleanup()
      if (tab.webContents.isDestroyed() || findTab(browser, tab.id) !== tab) return
      if (browser.activeTabId === tab.id || browser.splitViewContains(tab.id)) {
        browser.window.contentView.addChildView(tab.view)
      }
      browser.layout()
      if (focusPage && browser.activeTabId === tab.id) focusTabOrTrustedChrome(browser, tab)
    }
  }
}
