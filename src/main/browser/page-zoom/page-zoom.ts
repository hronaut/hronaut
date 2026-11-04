import { PAGE_ZOOM_LIMITS, PAGE_ZOOM_STEPS, pageZoomFactor } from '../../../shared/page-zoom.js'
import type { BrowserState } from '../../../shared/types.js'
import { LocalizedError } from '../../localized-error.js'
import type { Browser } from '../browser.js'
import { getTab } from '../browser-core.js'
import { browserState, publishChange } from '../browser-state/browser-state.js'
import { resetPinchZoom } from './pinch-zoom.js'

/** The tab's page zoom, read without changing it, and whether the tab keeps its zoom apart from its site's other tabs. */
export function readZoom(browser: Browser, tabId?: string): { tabId: string; zoomPercent: number; zoomIsolated: boolean } {
  const tab = getTab(browser, tabId)
  return { tabId: tab.id, zoomPercent: Math.round(tab.webContents.getZoomFactor() * 100), zoomIsolated: tab.zoomIsolated === true }
}

type ZoomChange = { tabId?: string; action: 'in' | 'out' | 'reset' | 'set'; percent?: number }

/**
 * Zooms the tab's page to Chrome's next or previous step, back to 100%, or to an exact percent from 25 to 500, then
 * returns the browser state. Back to 100% also undoes a pinch, as Chrome's Reset zoom does.
 */
export function setZoom(browser: Browser, options: ZoomChange): BrowserState {
  return changeZoom(browser, options).state
}

/** How long an agent's reset waits for its pinch to be undone, as a page that never answers would hold the call. */
const PINCH_RESET_WAIT_MS = 2_000

/**
 * As setZoom, for an agent: it answers once a reset has also undone a pinch, or at most PINCH_RESET_WAIT_MS later, so
 * that the agent's next input, which a pinched page refuses, finds the page at its normal scale.
 */
export async function setZoomForAgent(browser: Browser, options: ZoomChange): Promise<BrowserState> {
  const { pinchReset } = changeZoom(browser, options)
  let timer: ReturnType<typeof setTimeout> | undefined
  await Promise.race([pinchReset, new Promise<void>(resolve => { timer = setTimeout(resolve, PINCH_RESET_WAIT_MS) })])
  clearTimeout(timer)
  // The state as it is once the pinch is undone, with any change made meanwhile.
  return browserState(browser)
}

function changeZoom(browser: Browser, options: ZoomChange): { state: BrowserState; pinchReset: Promise<void> } {
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
  webContents.setZoomFactor(pageZoomFactor(percent))
  // A phone viewport an agent emulates sets its own scale, which shows a wide page smaller to fit, and the reset would
  // put Hronaut's limits back over it. A tab asleep has no page to pinch.
  const pinchReset = options.action === 'reset' && tab.emulation.viewport?.mobile !== true && !tab.sleeping
    ? resetPinchZoom(webContents).catch(() => undefined)
    : Promise.resolve()
  publishChange(browser, false)
  return { state: browserState(browser), pinchReset }
}
