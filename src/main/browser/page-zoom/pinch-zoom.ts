import type { WebContents } from 'electron'
import { isHronautHomeUrl } from '../url.js'
import { pageScriptsRunNow } from '../page-script-readiness.js'
import { isSourceViewUrl } from '../source-view-guard.js'

/**
 * How much larger than its normal scale a pinch can show a page: 3 times on macOS and 4 times elsewhere, Chromium's own
 * desktop limits. A pinch never shows it smaller.
 */
export const PINCH_ZOOM_MAXIMUM = process.platform === 'darwin' ? 3 : 4

/**
 * Whether a person pinched the page larger, so that it shows part of itself from an offset, larger still: the part shown
 * is narrower than the page's own viewport by more than the pixel its rounding takes. A phone viewport's own smaller
 * scale, which shows a wide page whole, is not a pinch. Reading the visual viewport's width first runs the page's
 * pending layout, which takes changed pinch limits, so the answer is the scale the page shows next.
 */
export const PAGE_PINCHED = `(() => {
  const visual = window.visualViewport
  if (!visual) return false
  const width = visual.width
  const root = document.compatMode === 'BackCompat' ? document.body : document.documentElement
  return Math.abs(visual.offsetLeft) > 0.01 || Math.abs(visual.offsetTop) > 0.01 || Boolean(root && root.clientWidth - width > 1)
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

/** How long a reset waits for the page to show its normal scale before it widens the limits again anyway. */
const NORMAL_SCALE_WAIT_MS = 1_000

/**
 * Shows a pinched page at its normal scale again, as Chrome's Reset zoom does. Electron has no call for it, so the pinch
 * limits are narrowed to the normal scale, which brings the page back to it, and then widened again. The page takes the
 * narrowed limits at its next layout and until then still reports its pinch, which a busy machine can put off past
 * the reset's answer, so the page is asked, which runs that layout, until it shows its normal scale, for at most
 * NORMAL_SCALE_WAIT_MS. A page that is not pinched keeps its limits, since setting them applies all of the tab's
 * preferences again, over the scale a phone viewport emulated in Developer Tools sets for itself. A page's source
 * refuses page scripts (see source-view-guard.ts), so it is asked through its main frame, whose own call answers there.
 */
export async function resetPinchZoom(webContents: WebContents): Promise<void> {
  const pinched = async (): Promise<boolean> => await (isSourceViewUrl(webContents.getURL())
    ? webContents.mainFrame.executeJavaScript(PAGE_PINCHED, false)
    : webContents.executeJavaScript(PAGE_PINCHED, false)) === true
  if (!await pinched()) return
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await webContents.setVisualZoomLevelLimits(1, 1)
    // A frame's call can stay unanswered while it reloads, and a page that opens another document answers only once
    // that document is ready, so neither is waited for.
    const late = new Promise<false>(resolve => { timer = setTimeout(() => resolve(false), NORMAL_SCALE_WAIT_MS) })
    while (pageScriptsRunNow(webContents) && await Promise.race([pinched().catch(() => false), late])) {
      await new Promise<void>(resolve => setTimeout(resolve, 16))
    }
  } finally {
    clearTimeout(timer)
    await webContents.setVisualZoomLevelLimits(1, pinchMaximum(webContents.getURL())).catch(() => undefined)
  }
}
