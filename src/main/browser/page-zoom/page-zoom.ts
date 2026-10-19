import type { BrowserState } from '../../../shared/types.js'
import { LocalizedError } from '../../localized-error.js'
import type { PageZoomAccess, PageZoomTab } from './page-zoom-access.js'

const PAGE_ZOOM_STEPS = [50, 60, 67, 75, 80, 90, 100, 110, 125, 150, 175, 200, 250, 300, 400] as const

/**
 * Zooms the tab's page to the next or previous step, back to 100%, or to an
 * exact percent from 50 to 400, then returns the browser state.
 */
export function setZoom<Tab extends PageZoomTab>(access: PageZoomAccess<Tab>, options: { tabId?: string; action: 'in' | 'out' | 'reset' | 'set'; percent?: number }): BrowserState {
  const tab = access.getTab(options.tabId)
  const webContents = tab.webContents
  tab.nativeInputEnvironmentGeneration += 1
  const current = Math.round(webContents.getZoomFactor() * 100)
  let percent: number
  if (options.action === 'reset') percent = 100
  else if (options.action === 'in') percent = PAGE_ZOOM_STEPS.find((step) => step > current) ?? PAGE_ZOOM_STEPS.at(-1)!
  else if (options.action === 'out') percent = [...PAGE_ZOOM_STEPS].reverse().find((step) => step < current) ?? PAGE_ZOOM_STEPS[0]
  else {
    if (options.percent === undefined || !Number.isInteger(options.percent) || options.percent < 50 || options.percent > 400) {
      throw new LocalizedError('appErrors.page.zoomPercent')
    }
    percent = options.percent
  }
  webContents.setZoomFactor(percent / 100)
  access.changed(false)
  return access.getState()
}
