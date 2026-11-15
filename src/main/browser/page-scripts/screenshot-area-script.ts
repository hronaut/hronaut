import { pageScript } from '../../../shared/page-script.js'
import { cancelScreenshotAreaInPage, screenshotAreaInPage, screenshotAreaNativeInputInPage } from './screenshot-area.page.js'

export type { ScreenshotAreaSelection } from './screenshot-area.page.js'

/** Lets the person drag out an area of the page to capture; see screenshotAreaInPage. */
export function screenshotAreaScript(): string {
  return pageScript(screenshotAreaInPage)
}

/** Hands a native pointer step, in main's viewport coordinates, to the running area picker. */
export function screenshotAreaNativeInputScript(
  type: 'down' | 'move' | 'up',
  x: number,
  y: number,
  viewportWidth: number,
  viewportHeight: number
): string {
  return pageScript(screenshotAreaNativeInputInPage, type, x, y, viewportWidth, viewportHeight)
}

/** Cancels the running area picker. */
export function cancelScreenshotAreaScript(): string {
  return pageScript(cancelScreenshotAreaInPage)
}
