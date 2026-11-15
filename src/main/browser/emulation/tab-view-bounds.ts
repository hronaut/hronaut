import type { Rectangle } from 'electron'
import { EMULATION_FRAME_CAPTION_SPACE, emulatedViewBounds } from '../../../shared/emulation-frame.js'
import type { Browser } from '../browser.js'
import type { BrowserTab } from '../browser-tab.js'

/** Where a tab's page goes in its space: see `emulationViewSize`. */
export function tabViewBounds(browser: Browser, tab: BrowserTab, space: Rectangle): Rectangle {
  // Rounded up, so the space is never less than the caption needs in shell pixels.
  const captionSpace = Math.ceil(EMULATION_FRAME_CAPTION_SPACE * (browser.window.webContents.getZoomFactor?.() ?? 1))
  return emulatedViewBounds(space, tab.emulationViewSize, captionSpace)
}
