import type { Rectangle, WebContentsView } from 'electron'
import { PAGE_CARD_RADIUS } from '../../../shared/page-card.js'
import { SPLIT_VIEW_GAP, splitViewBounds, splitViewGeometry, type SplitDividerGeometry } from '../../../shared/split-view.js'
import { browserViewBounds, shownPageFullscreenTab } from './content-area.js'
import type { Browser } from '../browser.js'
import { findTab } from '../browser-core.js'
import type { BrowserTab } from '../browser-tab.js'
import { exitHiddenPageFullscreen } from '../page-fullscreen/page-fullscreen.js'
import { publishPageGeometry } from '../page-geometry/page-geometry.js'
import { scheduleTabOverviewPreview } from '../tab-overview-previews/tab-overview-previews.js'

/**
 * Where the split view's divider is, in the shell's CSS pixels, with the
 * area it divides and the split view's revision; null when there is no
 * divider the person can drag, such as while a pane sleeps or is in full
 * screen, the person's input is locked or trusted chrome covers the pages.
 */
export function getSplitDivider(browser: Browser): SplitDividerGeometry | null {
  if (browser.destroyed || browser.window.isDestroyed() || browser.window.webContents.isDestroyed()
    || !browser.activeTabId || !browser.splitView || browser.allHumanInteractionLocked || browser.browserContentOccluded) return null
  const area = browserViewBounds(browser)
  const scale = browser.window.webContents.getZoomFactor?.() ?? 1
  const first = findTab(browser, browser.splitView!.firstTabId)
  const second = findTab(browser, browser.splitView!.secondTabId)
  if (!first || !second || first.sleeping || second.sleeping || first.pageFullscreen || second.pageFullscreen
    || first.webContents.isDestroyed() || second.webContents.isDestroyed()
    || browser.toolbarHeight >= browser.window.getContentBounds().height - 1) return null
  const gap = Math.round(SPLIT_VIEW_GAP * scale)
  const length = browser.splitView!.orientation === 'vertical' ? area.width : area.height
  if (length < gap + 2 || area.width < 1 || area.height < 1) return null
  const { divider } = splitViewGeometry(area, browser.splitView!.orientation, browser.splitView!.ratio, gap)
  const cssBounds = (rect: Rectangle): Rectangle => ({
    x: rect.x / scale, y: rect.y / scale, width: rect.width / scale, height: rect.height / scale
  })
  return { ...browser.splitView!, revision: browser.splitViewGeneration, bounds: cssBounds(divider), area: cssBounds(area), gap: gap / scale, scale }
}

/** Sends the divider's geometry to the shell when it changed since it was last sent. */
export function publishSplitDivider(browser: Browser): void {
  const geometry = getSplitDivider(browser)
  const serialized = JSON.stringify(geometry)
  if (serialized === browser.lastSplitDividerGeometry) return
  browser.lastSplitDividerGeometry = serialized
  if (!browser.window.webContents.isDestroyed()) browser.window.webContents.send('split-divider:changed', geometry)
}

/** Rounds a page view's corners to the shell's page card, which scales with the shell's zoom. */
export function roundPageCorners(browser: Browser, view: WebContentsView): void {
  const radius = Math.round(PAGE_CARD_RADIUS * (browser.window.webContents.getZoomFactor?.() ?? 1))
  if (browser.pageCornerRadii.get(view) === radius) return
  view.setBorderRadius(radius)
  browser.pageCornerRadii.set(view, radius)
}

/** Squares a page view's corners, for a page in full screen that fills the window. */
function squarePageCorners(browser: Browser, view: WebContentsView): void {
  if (browser.pageCornerRadii.get(view) === 0) return
  view.setBorderRadius(0)
  browser.pageCornerRadii.set(view, 0)
}

/**
 * Places, rounds and shows the pages in view: the active tab, or both panes
 * of the split view, which closes when a pane is gone. A shown page in full
 * screen fills the window with square corners, and the other pane waits
 * behind it. Pages are hidden while trusted chrome covers them, once the
 * still image of them shows, or while the window has no room for them, except
 * a page an offscreen capture holds in its own window. The divider and page
 * geometry are published to the shell, and a page in full screen the window
 * no longer shows is asked to leave it.
 */
export function layout(browser: Browser): void {
  if (browser.destroyed || browser.window.isDestroyed()) return
  browser.occlusionSnapshot.reconcile()
  if (!browser.activeTabId) {
    // A frame must not outlive the last tab.
    publishPageGeometry(browser)
    return
  }
  browser.splitDivider.reconcile()
  const tab = findTab(browser, browser.activeTabId!)
  if (!tab) return
  const bounds = browser.window.getContentBounds()
  // Renderer-owned trusted modals cannot be placed above a native
  // WebContentsView. Hiding the page is more reliable than collapsing it to
  // a one-pixel bound, which may not repaint until the BrowserWindow resizes.
  // Preserve hidden view bounds, then restore geometry before showing them.
  const browserContentVisible = (!browser.browserContentOccluded || browser.occlusionSnapshot.holdingPages) && browser.toolbarHeight < bounds.height - 1
  // Views held on screen under trusted chrome keep their place; they get new bounds before they are shown again.
  const placeViews = browserContentVisible && !browser.browserContentOccluded
  const fullscreenTab = shownPageFullscreenTab(browser)
  // A page an offscreen capture holds in a capture window of its own stays shown there. That window never covers
  // the shell, and a hidden page never presents the frame or surface the capture waits for, as on Windows while
  // the window is minimized.
  const showView = (shown: BrowserTab, visible: boolean): void => shown.view.setVisible(visible || (
    browser.offscreenCaptureTabIds.has(shown.id) && !browser.window.contentView.children.includes(shown.view)
  ))
  if (browser.splitView) {
    const firstTab = findTab(browser, browser.splitView!.firstTabId)
    const secondTab = findTab(browser, browser.splitView!.secondTabId)
    if (firstTab && secondTab && !fullscreenTab) {
      const splitBounds = splitViewBounds(browserViewBounds(browser), browser.splitView!.orientation, browser.splitView!.ratio, Math.round(SPLIT_VIEW_GAP * (browser.window.webContents.getZoomFactor?.() ?? 1)))
      if (placeViews) {
        firstTab.view.setBounds(browser.tabViewBounds(firstTab, splitBounds.first))
        secondTab.view.setBounds(browser.tabViewBounds(secondTab, splitBounds.second))
        roundPageCorners(browser, firstTab.view)
        roundPageCorners(browser, secondTab.view)
      }
      showView(firstTab, browserContentVisible && splitBounds.first.width > 0 && splitBounds.first.height > 0)
      showView(secondTab, browserContentVisible && splitBounds.second.width > 0 && splitBounds.second.height > 0)
      browser.reconcileTabPresentation(firstTab)
      browser.reconcileTabPresentation(secondTab)
      scheduleTabOverviewPreview(browser, firstTab)
      scheduleTabOverviewPreview(browser, secondTab)
      publishSplitDivider(browser)
      publishPageGeometry(browser)
      exitHiddenPageFullscreen(browser)
      return
    }
    if (firstTab && secondTab) showView(fullscreenTab === firstTab ? secondTab : firstTab, false)
    else browser.splitView = null
  }
  // The page in view: the split view's pane in full screen, or the active tab.
  const shownTab = browser.splitView ? fullscreenTab! : tab
  // Closing the split view can leave the pane in full screen out of view, with the active tab in its card.
  const fillsWindow = shownPageFullscreenTab(browser) === shownTab
  if (placeViews) {
    shownTab.view.setBounds(browser.tabViewBounds(shownTab, browserViewBounds(browser)))
    if (fillsWindow) squarePageCorners(browser, shownTab.view)
    else roundPageCorners(browser, shownTab.view)
  }
  showView(shownTab, browserContentVisible)
  browser.reconcileTabPresentation(shownTab)
  scheduleTabOverviewPreview(browser, shownTab)
  publishSplitDivider(browser)
  publishPageGeometry(browser)
  exitHiddenPageFullscreen(browser)
}
