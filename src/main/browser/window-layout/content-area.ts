import type { Rectangle } from 'electron'
import type { WindowLayoutAccess, WindowLayoutTab } from './window-layout-access.js'

/** The shortest the shell's toolbar can be, in window pixels. */
const MIN_SHELL_HEIGHT = 44

/** Records the shell's toolbar height, kept between the shortest shell and the window's height, and lays the pages out again. */
export function setToolbarHeight<Tab extends WindowLayoutTab>(access: WindowLayoutAccess<Tab>, height: number): void {
  if (access.isDestroyed() || access.window().isDestroyed()) return
  const contentHeight = access.window().getContentBounds().height
  access.writeToolbarHeight(Math.min(
    Math.max(Math.round(height), MIN_SHELL_HEIGHT),
    Math.max(MIN_SHELL_HEIGHT, contentHeight - 1)
  ))
  access.layout()
}

/** Records how far the shell reaches into the window below the toolbar, each inset whole, at least zero and short of the window, and lays the pages out again. */
export function setContentInsets<Tab extends WindowLayoutTab>(access: WindowLayoutAccess<Tab>, insets: { top: number; right: number; bottom: number; left: number }): void {
  if (access.isDestroyed() || access.window().isDestroyed()) return
  const bounds = access.window().getContentBounds()
  const finiteInset = (value: number, maximum: number): number => Math.min(
    Math.max(Math.round(Number.isFinite(value) ? value : 0), 0),
    Math.max(0, maximum)
  )
  access.writeContentInsets({
    top: finiteInset(insets.top, bounds.height - access.toolbarHeight() - 1),
    right: finiteInset(insets.right, bounds.width - 1),
    bottom: finiteInset(insets.bottom, bounds.height - access.toolbarHeight() - 1),
    left: finiteInset(insets.left, bounds.width - 1)
  })
  access.layout()
}

/** Where pages show, below the toolbar and beside the tab rail, in window coordinates; null once the window is gone. */
export function pageArea<Tab extends WindowLayoutTab>(access: WindowLayoutAccess<Tab>): Rectangle | null {
  if (access.isDestroyed() || access.window().isDestroyed()) return null
  return browserViewBounds(access)
}

/** The tab the window shows whose page is in full screen, such as a video: the active tab or a split view pane. */
export function shownPageFullscreenTab<Tab extends WindowLayoutTab>(access: WindowLayoutAccess<Tab>): Tab | undefined {
  const splitView = access.splitView()
  const shownIds = splitView ? [splitView.firstTabId, splitView.secondTabId] : [access.activeTabId()]
  for (const tabId of shownIds) {
    const tab = tabId ? access.findTab(tabId) : undefined
    if (tab?.pageFullscreen && !tab.sleeping) return tab
  }
  return undefined
}

/**
 * The space the browser gives tab views: the window below the toolbar, inside the shell's insets, at least one pixel
 * each way. A shown page in full screen gets the whole window instead.
 */
export function browserViewBounds<Tab extends WindowLayoutTab>(access: WindowLayoutAccess<Tab>): Rectangle {
  const bounds = access.window().getContentBounds()
  if (shownPageFullscreenTab(access)) return { x: 0, y: 0, width: Math.max(1, bounds.width), height: Math.max(1, bounds.height) }
  return {
    x: access.contentInsets().left,
    y: access.toolbarHeight() + access.contentInsets().top,
    width: Math.max(1, bounds.width - access.contentInsets().left - access.contentInsets().right),
    height: Math.max(1, bounds.height - access.toolbarHeight() - access.contentInsets().top - access.contentInsets().bottom)
  }
}
