import type { BrowserWindow } from 'electron'
import { scaleShellMetric } from '../../shared/interface-scale.js'

/**
 * The narrowest the shell lays out, in its own CSS pixels, as its toolbar, panels and Settings are made for: half of a
 * 1280-pixel screen and up holds it, so the window can sit beside another app, as Chrome's can.
 */
const MIN_SHELL_WIDTH = 600
const MIN_WINDOW_HEIGHT = 520

/** The main window's minimum size at an interface scale, which keeps the shell at least its narrowest width. */
export function mainWindowMinimumSize(scale: number): { width: number; height: number } {
  return { width: scaleShellMetric(MIN_SHELL_WIDTH, scale), height: MIN_WINDOW_HEIGHT }
}

/**
 * Gives the main window the minimum size of a new interface scale. A window narrower than a larger interface needs grows
 * to it, as a minimum set later does not resize it on every system; a maximized or full screen one fills its screen.
 */
export function applyMainWindowMinimumSize(window: BrowserWindow, scale: number): void {
  const minimum = mainWindowMinimumSize(scale)
  window.setMinimumSize(minimum.width, minimum.height)
  if (window.isMaximized() || window.isFullScreen()) return
  const [width = 0, height = 0] = window.getSize()
  if (width < minimum.width || height < minimum.height) {
    window.setSize(Math.max(width, minimum.width), Math.max(height, minimum.height))
  }
}
