import { settledViewportSize, type PageViewportSize } from '../viewport-settle.js'
import type { Browser } from '../browser.js'
import { findTab, getTab } from '../browser-core.js'

/**
 * Gives the tab's page an emulated desktop viewport of the given size, or
 * removes the viewport override, through the browser's emulate. It returns
 * the page's viewport size: the override's size, or after a reset the size the
 * page settles at in its view.
 */
export async function resizeViewport(browser: Browser, width: number | undefined, height: number | undefined, reset: boolean, tabId?: string): Promise<unknown> {
  const tab = getTab(browser, tabId)
  const webContents = tab.webContents
  if (reset) await browser.emulate({ tabId: tab.id, viewport: null })
  else {
    if (width === undefined || height === undefined) throw new Error('width and height are required unless reset is true')
    await browser.emulate({
      tabId: tab.id,
      viewport: { width, height, deviceScaleFactor: 1, mobile: false, touch: false, orientation: 'portrait' }
    })
  }
  // A size read needs no user activation, and a reset may read several times.
  const read = (): Promise<PageViewportSize> => webContents.executeJavaScript(`({ width: innerWidth, height: innerHeight, devicePixelRatio })`, false)
  // An override pins the page's size; without one the agent gets the size the page settles at in its view.
  if (!reset || tab.emulation.viewport) return read()
  const revision = tab.emulationRevision
  return settledViewportSize(read, () => {
    // A newer emulation change owns the view's size, so the wait ends with the page as it is.
    if (webContents.isDestroyed() || findTab(browser, tab.id) !== tab || tab.emulationRevision !== revision) return null
    const { width: viewWidth, height: viewHeight } = tab.view.getBounds()
    const zoom = webContents.getZoomFactor()
    return { width: viewWidth / zoom, height: viewHeight / zoom }
  })
}
