import { PAGE_ZOOM_LIMITS, PAGE_ZOOM_STEPS } from '../../../shared/page-zoom.js'
import type { BrowserState } from '../../../shared/types.js'
import { LocalizedError } from '../../localized-error.js'
import type { Browser } from '../browser.js'
import { getTab } from '../browser-core.js'
import { browserState, publishChange } from '../browser-state/browser-state.js'

/** The tab's page zoom, read without changing it, and whether the tab keeps its zoom apart from its site's other tabs. */
export function readZoom(browser: Browser, tabId?: string): { tabId: string; zoomPercent: number; zoomIsolated: boolean } {
  const tab = getTab(browser, tabId)
  return { tabId: tab.id, zoomPercent: Math.round(tab.webContents.getZoomFactor() * 100), zoomIsolated: tab.zoomIsolated === true }
}

/**
 * Zooms the tab's page to Chrome's next or previous step, back to 100%, or to an exact percent from 25 to 500, then
 * returns the browser state.
 */
export function setZoom(browser: Browser, options: { tabId?: string; action: 'in' | 'out' | 'reset' | 'set'; percent?: number }): BrowserState {
  const tab = getTab(browser, options.tabId)
  const webContents = tab.webContents
  tab.nativeInputEnvironmentGeneration += 1
  const current = Math.round(webContents.getZoomFactor() * 100)
  let percent: number
  if (options.action === 'reset') percent = 100
  else if (options.action === 'in') percent = PAGE_ZOOM_STEPS.find((step) => step > current) ?? PAGE_ZOOM_STEPS.at(-1)!
  else if (options.action === 'out') percent = [...PAGE_ZOOM_STEPS].reverse().find((step) => step < current) ?? PAGE_ZOOM_STEPS[0]
  else {
    const wanted = options.percent
    if (wanted === undefined || !Number.isInteger(wanted) || wanted < PAGE_ZOOM_LIMITS.min || wanted > PAGE_ZOOM_LIMITS.max) {
      throw new LocalizedError('appErrors.page.zoomPercent')
    }
    percent = wanted
  }
  webContents.setZoomFactor(percent / 100)
  publishChange(browser, false)
  return browserState(browser)
}
