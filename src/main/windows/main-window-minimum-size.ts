import { screen, type BrowserWindow } from 'electron'
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
 * Gives the main window the minimum size of an interface scale, with room for a system title bar's frame. A window
 * narrower than a larger interface needs grows to it, as a minimum set later does not resize it on every system, and
 * stays on its screen; a maximized or full screen one fills its screen, and grows when it is restored.
 */
export function applyMainWindowMinimumSize(window: BrowserWindow, scale: number): void {
  const minimum = mainWindowMinimumSize(scale)
  const [outerWidth = 0] = window.getSize()
  const [contentWidth = 0] = window.getContentSize()
  const width = minimum.width + Math.max(0, outerWidth - contentWidth)
  window.setMinimumSize(width, minimum.height)
  if (window.isMaximized() || window.isFullScreen()) return
  const bounds = window.getBounds()
  if (bounds.width >= width && bounds.height >= minimum.height) return
  const grown = { width: Math.max(bounds.width, width), height: Math.max(bounds.height, minimum.height) }
  const area = screen.getDisplayMatching(bounds).workArea
  window.setBounds({
    x: Math.max(area.x, Math.min(bounds.x, area.x + area.width - grown.width)),
    y: Math.max(area.y, Math.min(bounds.y, area.y + area.height - grown.height)),
    ...grown
  })
}
