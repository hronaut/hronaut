import type { EmulationAccess, EmulationTab } from './emulation-access.js'

/**
 * Sizes a tab's page for the emulated viewport it now has, or for its whole
 * space. A tab in the background gets the size it would have in front, so
 * its real viewport and captures follow a change made while it is hidden.
 */
export function setEmulationViewSize<Tab extends EmulationTab>(access: EmulationAccess<Tab>, tab: Tab, viewport: { width: number; height: number } | undefined): void {
  const size = viewport ? { width: viewport.width, height: viewport.height } : undefined
  const resized = size?.width !== tab.emulationViewSize?.width || size?.height !== tab.emulationViewSize?.height
  tab.emulationViewSize = size
  if (access.isDestroyed() || access.window().isDestroyed() || access.findTab(tab.id) !== tab || tab.webContents.isDestroyed()
    || access.offscreenCaptureTabIds().has(tab.id)) return
  try {
    const attached = access.window().contentView.children.includes(tab.view)
    if (attached && (access.activeTabId() === tab.id || access.splitViewContains(tab.id))) {
      if (resized) access.layout()
      // The caption can change without the size, such as the pixel ratio.
      else access.publishPageGeometry()
    } else if (resized && !attached) {
      tab.view.setBounds(access.tabViewBounds(tab, access.contentAreaBounds()))
    }
    // An attached tab that is not in front stands in for a tab closing behind
    // its beforeunload check, and gets its size when it is next laid out.
  } catch (error) {
    // Electron can tear a view down under a debugger detach or renderer exit.
    console.warn(`[browser] Could not resize tab ${tab.id} for its viewport:`, error)
  }
}
