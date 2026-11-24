import type { WebContents } from 'electron'
import { pageScript } from '../../shared/page-script.js'
import { canvasAtPointInPage } from './canvas-copy.page.js'
import { ISOLATED_WORLDS } from './isolated-worlds.js'

/** Whether the canvas at (x, y) shows another website's picture; false when that cannot be told. */
export async function canvasAtPointIsTainted(webContents: Pick<WebContents, 'executeJavaScriptInIsolatedWorld'>, x: number, y: number): Promise<boolean> {
  try {
    const code = pageScript(canvasAtPointInPage, x, y)
    return await webContents.executeJavaScriptInIsolatedWorld(ISOLATED_WORLDS.canvasCopy, [{ code }]) === 'tainted'
  } catch {
    return false
  }
}
