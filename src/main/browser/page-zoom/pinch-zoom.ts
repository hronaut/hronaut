import type { WebContents } from 'electron'
import { isHronautHomeUrl } from '../url.js'

/**
 * How much larger than its normal scale a pinch can show a page: 3 times on macOS and 4 times elsewhere, Chromium's own
 * desktop limits. A pinch never shows it smaller.
 */
export const PINCH_ZOOM_MAXIMUM = process.platform === 'darwin' ? 3 : 4

/**
 * Whether a person pinched the page larger, so that it shows part of itself from an offset, larger still: the part shown
 * is narrower than the page's own viewport by more than the pixel its rounding takes. A phone viewport's own smaller
 * scale, which shows a wide page whole, is not a pinch.
 */
export const PAGE_PINCHED = `(() => {
  const visual = window.visualViewport
  const root = document.compatMode === 'BackCompat' ? document.body : document.documentElement
  return Boolean(visual && (Math.abs(visual.offsetLeft) > 0.01 || Math.abs(visual.offsetTop) > 0.01
    || (root && root.clientWidth - visual.width > 1)))
})()`

/** How much larger a pinch can show the page at an address: Hronaut Home, Hronaut's own page, stays at its normal size. */
function pinchMaximum(url: string): number {
  return isHronautHomeUrl(url) ? 1 : PINCH_ZOOM_MAXIMUM
}

function setPinchLimits(webContents: WebContents, url: string): void {
  // A tab with no renderer yet, such as one asleep, still keeps the limits for its first page.
  void webContents.setVisualZoomLevelLimits(1, pinchMaximum(url)).catch(() => undefined)
}

/**
 * Lets the person pinch a tab's websites larger with a touchpad or touch screen, as in Chrome; Electron turns pinch zoom
 * off. The limits stay with the tab, so they change only when it goes to or from Hronaut Home, which opens at its
 * normal size and has no zoom to reset a pinch. Setting them applies all of the tab's preferences again, which would put
 * Hronaut's limits over the scale a phone viewport an agent emulates sets for itself, so while `keepsOwnScale` says the
 * tab has one, they wait for its next change of address.
 */
export function allowPinchZoom(webContents: WebContents, url: string, keepsOwnScale: () => boolean): void {
  let maximum = pinchMaximum(url)
  setPinchLimits(webContents, url)
  webContents.on('did-navigate', (_event, address) => {
    if (pinchMaximum(address) === maximum || keepsOwnScale()) return
    maximum = pinchMaximum(address)
    setPinchLimits(webContents, address)
  })
}

/**
 * Shows a pinched page at its normal scale again, as Chrome's Reset zoom does. Electron has no call for it, so the pinch
 * limits are narrowed to the normal scale, which brings the page back to it, and then widened again. A page that is not
 * pinched keeps its limits, since setting them applies all of the tab's preferences again, over the scale a phone
 * viewport emulated in Developer Tools sets for itself.
 */
export async function resetPinchZoom(webContents: WebContents): Promise<void> {
  if (await webContents.executeJavaScript(PAGE_PINCHED, false) !== true) return
  try {
    await webContents.setVisualZoomLevelLimits(1, 1)
  } finally {
    await webContents.setVisualZoomLevelLimits(1, pinchMaximum(webContents.getURL())).catch(() => undefined)
  }
}
