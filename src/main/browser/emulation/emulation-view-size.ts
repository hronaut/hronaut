import type { Browser } from '../browser.js'
import { findTab } from '../browser-core.js'
import type { BrowserTab } from '../browser-tab.js'
import { publishPageGeometry } from '../page-geometry/page-geometry.js'
import { contentAreaBounds } from '../window-layout/content-area.js'

/**
 * Sizes a tab's page for the emulated viewport it now has, or for its whole
 * space. A tab in the background gets the size it would have in front, so
 * its real viewport and captures follow a change made while it is hidden.
 */
export function setEmulationViewSize(browser: Browser, tab: BrowserTab, viewport: { width: number; height: number } | undefined): void {
  const size = viewport ? { width: viewport.width, height: viewport.height } : undefined
  const resized = size?.width !== tab.emulationViewSize?.width || size?.height !== tab.emulationViewSize?.height
  tab.emulationViewSize = size
  if (browser.destroyed || browser.window.isDestroyed() || findTab(browser, tab.id) !== tab || tab.webContents.isDestroyed()
    || browser.offscreenCaptureTabIds.has(tab.id)) return
  try {
    const attached = browser.window.contentView.children.includes(tab.view)
    if (attached && (browser.activeTabId === tab.id || browser.splitViewContains(tab.id))) {
      if (resized) browser.layout()
      // The caption can change without the size, such as the pixel ratio.
      else publishPageGeometry(browser)
    } else if (resized && !attached) {
      tab.view.setBounds(browser.tabViewBounds(tab, contentAreaBounds(browser)))
    }
    // An attached tab that is not in front stands in for a tab closing behind
    // its beforeunload check, and gets its size when it is next laid out.
  } catch (error) {
    // Electron can tear a view down under a debugger detach or renderer exit.
    console.warn(`[browser] Could not resize tab ${tab.id} for its viewport:`, error)
  }
}
