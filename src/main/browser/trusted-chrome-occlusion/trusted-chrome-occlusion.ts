import type { Rectangle } from 'electron'
import type { TrustedChromeOcclusionAccess, TrustedChromeOcclusionTab } from './trusted-chrome-occlusion-access.js'

/**
 * Covers the pages with trusted chrome, or uncovers them. Covering keeps the
 * page geometry the shell shows, dismisses website dialogs, moves keyboard
 * focus to the shell and starts the still image of the pages; uncovering
 * ends it and focuses the page that waited for trusted chrome to close.
 * Either change invalidates native input begun before it.
 */
export function setBrowserContentOccluded<Tab extends TrustedChromeOcclusionTab>(
  access: TrustedChromeOcclusionAccess<Tab>,
  occluded: boolean,
  request: number
): void {
  if (access.isDestroyed() || access.window().isDestroyed()) return
  if (occluded !== access.browserContentOccluded()) {
    for (const tab of access.tabs()) tab.nativeInputEnvironmentGeneration += 1
  }
  const enteringTrustedChrome = occluded && !access.browserContentOccluded()
  const leavingTrustedChrome = !occluded && access.browserContentOccluded()
  if (enteringTrustedChrome) {
    for (const tab of access.tabs()) {
      if (
        !tab.sleeping
        && !tab.webContents.isDestroyed()
        && tab.view.getVisible()
        && (tab.id === access.activeTabId() || access.splitViewContains(tab.id))
      ) {
        // The trusted renderer must hide native page views to paint above
        // them. Remember only views that were actually visible immediately
        // before that transition so their first in-flight capture can be
        // retried with stayHidden after the overview opens.
        access.tabOverviewPreviewableTabs().add(tab.id)
      }
    }
  }
  // The frames around emulated pages, and the cards under all pages, stay where the snapshot shows those pages.
  if (enteringTrustedChrome) {
    access.writeOccludedEmulationFrames(access.getEmulationFrames())
    access.writeOccludedPageCards(access.getPageCards())
  }
  access.writeBrowserContentOccluded(occluded)
  access.mcpActivityFollower().setOccluded(occluded || access.followAgentActivitySuspended())
  if (enteringTrustedChrome) {
    for (const tab of access.tabs()) {
      if (tab.dialog) void access.dismissWebsiteDialogForTrustedChrome(tab)
    }
    // Keys typed into trusted chrome must not reach the page while it stays on screen for its snapshot.
    if (access.window().isFocused()) access.window().webContents.focus()
    access.occlusionSnapshot().begin(request)
  } else if (!occluded) {
    access.occlusionSnapshot().end()
  } else {
    // The shell waits for this report before a question over the pages takes answers.
    access.occlusionSnapshot().confirmPagesHidden(request)
  }
  access.layout()
  if (leavingTrustedChrome) {
    const tab = access.cancelFocusAfterTrustedChrome()
    if (tab && access.findTab(tab.id) === tab && access.activeTabId() === tab.id && !tab.webContents.isDestroyed()) access.focusTabOrTrustedChrome(tab)
  }
}

/** Pages on screen now, at their current view bounds, that can be captured for the occlusion snapshot. */
export function occlusionSnapshotPanes<Tab extends TrustedChromeOcclusionTab>(access: TrustedChromeOcclusionAccess<Tab>): Array<{ contents: Electron.WebContents; bounds: Rectangle; busy?: Promise<void> }> {
  if (!access.window().isVisible() || access.window().isMinimized() || access.window().webContents.isDestroyed()) return []
  return presentedTabs(access).flatMap((tab) => (
    !tab.webContents.isDestroyed()
    && tab.view.getVisible()
    && access.window().contentView.children.includes(tab.view)
      ? [{ contents: tab.webContents, bounds: tab.view.getBounds(), busy: access.nativePreviewCapture().settled(tab.webContents) }]
      : []
  ))
}

/** The tabs shown in the page area. */
function presentedTabs<Tab extends TrustedChromeOcclusionTab>(access: TrustedChromeOcclusionAccess<Tab>): Tab[] {
  const tab = access.activeTabId() ? access.findTab(access.activeTabId()!) : undefined
  if (!tab) return []
  const first = access.splitView() ? access.findTab(access.splitView()!.firstTabId) : undefined
  const second = access.splitView() ? access.findTab(access.splitView()!.secondTabId) : undefined
  return access.splitView() && first && second ? [first, second] : [tab]
}

/**
 * What decides where the occluded pages are. Page views keep their bounds
 * while trusted chrome is open, so shell insets that change under a modal do
 * not move them; the window size, zoom and the tabs shown do.
 */
export function occlusionLayout<Tab extends TrustedChromeOcclusionTab>(access: TrustedChromeOcclusionAccess<Tab>): string {
  const { width, height } = access.window().getContentBounds()
  const zoom = access.window().webContents.isDestroyed() ? 1 : access.window().webContents.getZoomFactor?.() ?? 1
  return JSON.stringify([width, height, zoom, access.splitView()?.orientation ?? null, access.splitView()?.ratio ?? null,
    ...presentedTabs(access).map((tab) => [tab.id, tab.emulationViewSize?.width ?? null, tab.emulationViewSize?.height ?? null])])
}

/** Suspends following agent activity, or resumes it unless trusted chrome covers the pages. */
export function setFollowAgentActivitySuspended<Tab extends TrustedChromeOcclusionTab>(access: TrustedChromeOcclusionAccess<Tab>, suspended: boolean): void {
  if (access.isDestroyed() || access.window().isDestroyed()) return
  if (access.followAgentActivitySuspended() === suspended) return
  access.writeFollowAgentActivitySuspended(suspended)
  access.mcpActivityFollower().setOccluded(access.browserContentOccluded() || suspended)
}
