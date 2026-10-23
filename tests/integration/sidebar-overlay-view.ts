import type { ElectronApplication } from '@playwright/test'

export interface SidebarOverlayView {
  /** In the window and shown. */
  visible: boolean
  bounds: { x: number; y: number; width: number; height: number }
  zoom: number
  /** Where it sits among the window's views, from the bottom, and how many there are. */
  index: number
  count: number
}

/** The native view main draws the tab rail in over the page, while it is in the window. */
export async function sidebarOverlayView(electronApp: ElectronApplication): Promise<SidebarOverlayView | null> {
  return electronApp.evaluate(({ BrowserWindow }) => {
    const isSidebar = (child: Electron.View): boolean => (
      'webContents' in child && (child as Electron.WebContentsView).webContents.getURL().endsWith('sidebar-overlay.html')
    )
    const children = BrowserWindow.getAllWindows().find((window) => window.contentView.children.some(isSidebar))?.contentView.children ?? []
    const view = children.find(isSidebar) as Electron.WebContentsView | undefined
    if (!view) return null
    return {
      visible: view.getVisible(),
      bounds: view.getBounds(),
      zoom: view.webContents.getZoomFactor(),
      index: children.indexOf(view),
      count: children.length
    }
  })
}

/** Whether main shows the rail over the page now. */
export async function sidebarOverlayShown(electronApp: ElectronApplication): Promise<boolean> {
  return (await sidebarOverlayView(electronApp))?.visible === true
}

/** Runs a script in the rail's view, as `executeJavaScript` does, and returns its result. */
export async function evaluateInSidebarOverlay<T>(electronApp: ElectronApplication, script: string): Promise<T> {
  return electronApp.evaluate(async ({ webContents }, source) => {
    const contents = webContents.getAllWebContents().find((candidate) => candidate.getURL().endsWith('sidebar-overlay.html'))
    if (!contents) throw new Error('The sidebar overlay view is not loaded')
    return await contents.executeJavaScript(source) as unknown
  }, script) as Promise<T>
}
