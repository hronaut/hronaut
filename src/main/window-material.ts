import type { BrowserWindow } from 'electron'
import { WINDOW_MATERIAL_BACKGROUND, type WindowMaterial } from '../shared/window-material.js'

export type MaterialWindow = Pick<BrowserWindow, 'isDestroyed' | 'setVibrancy' | 'setBackgroundMaterial' | 'setBackgroundColor'>

/**
 * Shows `next` behind the window, or removes the material it shows, and sets the window's background to match: clear
 * while a material shows through, `solidBackground` otherwise. The system material changes only when it differs from
 * `shown`; the background is set every time, since the theme's surface can change on its own. Returns what now shows,
 * which is `next` even before the window exists, so the window is created with it.
 */
export function applyWindowMaterial(
  window: MaterialWindow | null | undefined,
  platform: NodeJS.Platform,
  shown: WindowMaterial | null,
  next: WindowMaterial | null,
  solidBackground: string
): WindowMaterial | null {
  if (!window || window.isDestroyed()) return next
  if (next !== shown) {
    if (platform === 'darwin') window.setVibrancy(next ? 'sidebar' : null)
    // Removing Mica resets the background to white, so the theme's surface is set after it.
    else if (platform === 'win32') window.setBackgroundMaterial(next ? 'mica' : 'none')
  }
  window.setBackgroundColor(next ? WINDOW_MATERIAL_BACKGROUND : solidBackground)
  return next
}
