import type { Rectangle } from 'electron'
import type { Browser } from '../browser.js'
import { cancelFocusAfterTrustedChrome, focusTabOrTrustedChrome } from '../trusted-chrome-focus/trusted-chrome-focus.js'
import { dismissWebsiteDialogForTrustedChrome } from '../website-dialogs/website-dialogs.js'
import { findTab } from '../browser-core.js'
import type { BrowserTab } from '../browser-tab.js'

/**
 * Covers the pages with trusted chrome, or uncovers them. Covering keeps the
 * page geometry the shell shows, dismisses website dialogs, moves keyboard
 * focus to the shell and starts the still image of the pages; uncovering
 * ends it and focuses the page that waited for trusted chrome to close.
 * Either change invalidates native input begun before it.
 */
export function setBrowserContentOccluded(
  browser: Browser,
  occluded: boolean,
  request: number
): void {
  if (browser.destroyed || browser.window.isDestroyed()) return
  if (occluded !== browser.browserContentOccluded) {
    for (const tab of browser.tabs.values()) tab.nativeInputEnvironmentGeneration += 1
  }
  const enteringTrustedChrome = occluded && !browser.browserContentOccluded
  const leavingTrustedChrome = !occluded && browser.browserContentOccluded
  if (enteringTrustedChrome) {
    for (const tab of browser.tabs.values()) {
      if (
        !tab.sleeping
        && !tab.webContents.isDestroyed()
        && tab.view.getVisible()
        && (tab.id === browser.activeTabId || browser.splitViewContains(tab.id))
      ) {
        // The trusted renderer must hide native page views to paint above
        // them. Remember only views that were actually visible immediately
        // before that transition so their first in-flight capture can be
        // retried with stayHidden after the overview opens.
        browser.tabOverviewPreviewableTabs.add(tab.id)
      }
    }
  }
  // The frames around emulated pages, and the cards under all pages, stay where the snapshot shows those pages.
  if (enteringTrustedChrome) {
    browser.occludedEmulationFrames = browser.getEmulationFrames()
    browser.occludedPageCards = browser.getPageCards()
  }
  browser.browserContentOccluded = occluded
  browser.mcpActivityFollower.setOccluded(occluded || browser.followAgentActivitySuspended)
  if (enteringTrustedChrome) {
    for (const tab of browser.tabs.values()) {
      if (tab.dialog) void dismissWebsiteDialogForTrustedChrome(browser, tab)
    }
    // Keys typed into trusted chrome must not reach the page while it stays on screen for its snapshot.
    if (browser.window.isFocused()) browser.window.webContents.focus()
    browser.occlusionSnapshot.begin(request)
  } else if (!occluded) {
    browser.occlusionSnapshot.end()
  } else {
    // The shell waits for this report before a question over the pages takes answers.
    browser.occlusionSnapshot.confirmPagesHidden(request)
  }
  browser.layout()
  if (leavingTrustedChrome) {
    const tab = cancelFocusAfterTrustedChrome(browser)
    if (tab && findTab(browser, tab.id) === tab && browser.activeTabId === tab.id && !tab.webContents.isDestroyed()) focusTabOrTrustedChrome(browser, tab)
  }
}

/** Pages on screen now, at their current view bounds, that can be captured for the occlusion snapshot. */
export function occlusionSnapshotPanes(browser: Browser): Array<{ contents: Electron.WebContents; bounds: Rectangle; busy?: Promise<void> }> {
  if (!browser.window.isVisible() || browser.window.isMinimized() || browser.window.webContents.isDestroyed()) return []
  return presentedTabs(browser).flatMap((tab) => (
    !tab.webContents.isDestroyed()
    && tab.view.getVisible()
    && browser.window.contentView.children.includes(tab.view)
      ? [{ contents: tab.webContents, bounds: tab.view.getBounds(), busy: browser.nativePreviewCapture.settled(tab.webContents) }]
      : []
  ))
}

/** The tabs shown in the page area. */
function presentedTabs(browser: Browser): BrowserTab[] {
  const tab = browser.activeTabId ? findTab(browser, browser.activeTabId) : undefined
  if (!tab) return []
  const first = browser.splitView ? findTab(browser, browser.splitView.firstTabId) : undefined
  const second = browser.splitView ? findTab(browser, browser.splitView.secondTabId) : undefined
  return browser.splitView && first && second ? [first, second] : [tab]
}

/**
 * What decides where the occluded pages are. Page views keep their bounds
 * while trusted chrome is open, so shell insets that change under a modal do
 * not move them; the window size, zoom and the tabs shown do.
 */
export function occlusionLayout(browser: Browser): string {
  const { width, height } = browser.window.getContentBounds()
  const zoom = browser.window.webContents.isDestroyed() ? 1 : browser.window.webContents.getZoomFactor?.() ?? 1
  return JSON.stringify([width, height, zoom, browser.splitView?.orientation ?? null, browser.splitView?.ratio ?? null,
    ...presentedTabs(browser).map((tab) => [tab.id, tab.emulationViewSize?.width ?? null, tab.emulationViewSize?.height ?? null])])
}

/** Suspends following agent activity, or resumes it unless trusted chrome covers the pages. */
export function setFollowAgentActivitySuspended(browser: Browser, suspended: boolean): void {
  if (browser.destroyed || browser.window.isDestroyed()) return
  if (browser.followAgentActivitySuspended === suspended) return
  browser.followAgentActivitySuspended = suspended
  browser.mcpActivityFollower.setOccluded(browser.browserContentOccluded || suspended)
}
