import type { Rectangle } from 'electron'
import { SPLIT_VIEW_GAP, splitViewBounds, splitViewGeometry, type SplitDividerGeometry } from '../../../shared/split-view.js'
import { shownPageFullscreenTab } from './content-area.js'
import type { WindowLayoutAccess, WindowLayoutTab } from './window-layout-access.js'

/**
 * Where the split view's divider is, in the shell's CSS pixels, with the
 * area it divides and the split view's revision; null when there is no
 * divider the person can drag, such as while a pane sleeps or is in full
 * screen, the person's input is locked or trusted chrome covers the pages.
 */
export function getSplitDivider<Tab extends WindowLayoutTab>(access: WindowLayoutAccess<Tab>): SplitDividerGeometry | null {
  if (access.isDestroyed() || access.window().isDestroyed() || access.window().webContents.isDestroyed()
    || !access.activeTabId() || !access.splitView() || access.allHumanInteractionLocked() || access.browserContentOccluded()) return null
  const area = access.browserViewBounds()
  const scale = access.window().webContents.getZoomFactor?.() ?? 1
  const first = access.findTab(access.splitView()!.firstTabId)
  const second = access.findTab(access.splitView()!.secondTabId)
  if (!first || !second || first.sleeping || second.sleeping || first.pageFullscreen || second.pageFullscreen
    || first.webContents.isDestroyed() || second.webContents.isDestroyed()
    || access.toolbarHeight() >= access.window().getContentBounds().height - 1) return null
  const gap = Math.round(SPLIT_VIEW_GAP * scale)
  const length = access.splitView()!.orientation === 'vertical' ? area.width : area.height
  if (length < gap + 2 || area.width < 1 || area.height < 1) return null
  const { divider } = splitViewGeometry(area, access.splitView()!.orientation, access.splitView()!.ratio, gap)
  const cssBounds = (rect: Rectangle): Rectangle => ({
    x: rect.x / scale, y: rect.y / scale, width: rect.width / scale, height: rect.height / scale
  })
  return { ...access.splitView()!, revision: access.splitViewGeneration(), bounds: cssBounds(divider), area: cssBounds(area), gap: gap / scale, scale }
}

/** Sends the divider's geometry to the shell when it changed since it was last sent. */
export function publishSplitDivider<Tab extends WindowLayoutTab>(access: WindowLayoutAccess<Tab>): void {
  const geometry = getSplitDivider(access)
  const serialized = JSON.stringify(geometry)
  if (serialized === access.lastSplitDividerGeometry()) return
  access.writeLastSplitDividerGeometry(serialized)
  if (!access.window().webContents.isDestroyed()) access.window().webContents.send('split-divider:changed', geometry)
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
export function layout<Tab extends WindowLayoutTab>(access: WindowLayoutAccess<Tab>): void {
  if (access.isDestroyed() || access.window().isDestroyed()) return
  access.occlusionSnapshot().reconcile()
  if (!access.activeTabId()) {
    // A frame must not outlive the last tab.
    access.publishPageGeometry()
    return
  }
  access.splitDivider().reconcile()
  const tab = access.findTab(access.activeTabId()!)
  if (!tab) return
  const bounds = access.window().getContentBounds()
  // Renderer-owned trusted modals cannot be placed above a native
  // WebContentsView. Hiding the page is more reliable than collapsing it to
  // a one-pixel bound, which may not repaint until the BrowserWindow resizes.
  // Preserve hidden view bounds, then restore geometry before showing them.
  const browserContentVisible = (!access.browserContentOccluded() || access.occlusionSnapshot().holdingPages) && access.toolbarHeight() < bounds.height - 1
  // Views held on screen under trusted chrome keep their place; they get new bounds before they are shown again.
  const placeViews = browserContentVisible && !access.browserContentOccluded()
  const fullscreenTab = shownPageFullscreenTab(access)
  // A page an offscreen capture holds in a capture window of its own stays shown there. That window never covers
  // the shell, and a hidden page never presents the frame or surface the capture waits for, as on Windows while
  // the window is minimized.
  const showView = (shown: Tab, visible: boolean): void => shown.view.setVisible(visible || (
    access.offscreenCaptureTabIds().has(shown.id) && !access.window().contentView.children.includes(shown.view)
  ))
  if (access.splitView()) {
    const firstTab = access.findTab(access.splitView()!.firstTabId)
    const secondTab = access.findTab(access.splitView()!.secondTabId)
    if (firstTab && secondTab && !fullscreenTab) {
      const splitBounds = splitViewBounds(access.browserViewBounds(), access.splitView()!.orientation, access.splitView()!.ratio, Math.round(SPLIT_VIEW_GAP * (access.window().webContents.getZoomFactor?.() ?? 1)))
      if (placeViews) {
        firstTab.view.setBounds(access.tabViewBounds(firstTab, splitBounds.first))
        secondTab.view.setBounds(access.tabViewBounds(secondTab, splitBounds.second))
        access.roundPageCorners(firstTab.view)
        access.roundPageCorners(secondTab.view)
      }
      showView(firstTab, browserContentVisible && splitBounds.first.width > 0 && splitBounds.first.height > 0)
      showView(secondTab, browserContentVisible && splitBounds.second.width > 0 && splitBounds.second.height > 0)
      access.reconcileTabPresentation(firstTab)
      access.reconcileTabPresentation(secondTab)
      access.scheduleTabOverviewPreview(firstTab)
      access.scheduleTabOverviewPreview(secondTab)
      access.publishSplitDivider()
      access.publishPageGeometry()
      access.exitHiddenPageFullscreen()
      return
    }
    if (firstTab && secondTab) showView(fullscreenTab === firstTab ? secondTab : firstTab, false)
    else access.writeSplitView(null)
  }
  // The page in view: the split view's pane in full screen, or the active tab.
  const shownTab = access.splitView() ? fullscreenTab! : tab
  // Closing the split view can leave the pane in full screen out of view, with the active tab in its card.
  const fillsWindow = shownPageFullscreenTab(access) === shownTab
  if (placeViews) {
    shownTab.view.setBounds(access.tabViewBounds(shownTab, access.browserViewBounds()))
    if (fillsWindow) access.squarePageCorners(shownTab.view)
    else access.roundPageCorners(shownTab.view)
  }
  showView(shownTab, browserContentVisible)
  access.reconcileTabPresentation(shownTab)
  access.scheduleTabOverviewPreview(shownTab)
  access.publishSplitDivider()
  access.publishPageGeometry()
  access.exitHiddenPageFullscreen()
}
