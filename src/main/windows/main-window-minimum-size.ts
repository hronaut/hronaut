import { screen, type BrowserWindow, type Rectangle } from 'electron'
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

/** Windows whose minimum waits until they have their own size again, as a larger one chosen while they were maximized. */
const waiting = new WeakSet<BrowserWindow>()
/** The minimum last given to each window: the shell's width and the frame measured with it. */
const applied = new WeakMap<BrowserWindow, { shellWidth: number; frame: number }>()

/** How far, in pixels, bounds may be from a work area or screen and still fill it, as Windows rounds them. */
const FILL_TOLERANCE = 2

/** Whether the window has its own size, rather than its screen's or none. */
function hasNormalSize(window: BrowserWindow): boolean {
  return !window.isMaximized() && !window.isFullScreen() && !window.isMinimized()
}

/** The frame a system title bar adds to the window's width, which is only whole while the window has its own size. */
function frameWidth(window: BrowserWindow): number {
  const [outerWidth = 0] = window.getSize()
  const [contentWidth = 0] = window.getContentSize()
  return Math.max(0, outerWidth - contentWidth)
}

/** Where a window edge goes when the window grows: back by as far as growing pushed it past its screen's far edge. */
function shiftedBack(start: number, size: number, grownSize: number, areaStart: number, areaSize: number): number {
  const areaEnd = areaStart + areaSize
  const pushedPast = Math.max(0, start + grownSize - areaEnd) - Math.max(0, start + size - areaEnd)
  return Math.max(Math.min(start, areaStart), start - pushedPast)
}

/**
 * Gives the main window the minimum size of an interface scale, with room for a system title bar's frame. A window
 * narrower than a larger interface needs grows to it, as a minimum set later does not resize it on every system, and
 * stays on its screen. A maximized, full screen or minimized window takes a smaller minimum at once, with the frame
 * measured last, so snapping it beside another app is not held to the larger one; a larger minimum waits until the
 * window has its own size again, so its frame is measured at that size and the system never grows the window past its
 * screen as it gives the size back.
 */
export function applyMainWindowMinimumSize(window: BrowserWindow, scale: number): void {
  const minimum = mainWindowMinimumSize(scale)
  if (!hasNormalSize(window)) {
    waiting.add(window)
    const last = applied.get(window)
    if (last && minimum.width <= last.shellWidth) {
      applied.set(window, { shellWidth: minimum.width, frame: last.frame })
      window.setMinimumSize(minimum.width + last.frame, minimum.height)
    }
    return
  }
  waiting.delete(window)
  const frame = frameWidth(window)
  applied.set(window, { shellWidth: minimum.width, frame })
  const width = minimum.width + frame
  window.setMinimumSize(width, minimum.height)
  const bounds = window.getBounds()
  if (bounds.width >= width && bounds.height >= minimum.height) return
  const grown = { width: Math.max(bounds.width, width), height: Math.max(bounds.height, minimum.height) }
  const area = screen.getDisplayMatching(bounds).workArea
  window.setBounds({
    x: shiftedBack(bounds.x, bounds.width, grown.width, area.x, area.width),
    y: shiftedBack(bounds.y, bounds.height, grown.height, area.y, area.height),
    ...grown
  })
}

/**
 * Keeps the window at its minimum once it has its own size again, after it is restored or as it is resized: a minimum
 * that waited is applied. Once restored, a window the system left narrower than its minimum also grows, as a macOS
 * window does that ends its unzoom at its old width after resizing through larger ones; a resize alone leaves that to
 * the system, so a tiling window manager that keeps the window smaller is not answered with another resize each time.
 * While the window still fills its screen's work area or its whole screen, it waits on: a window manager can say it
 * left maximized before giving it its size back.
 */
export function keepMainWindowMinimumSize(window: BrowserWindow, scale: number, options: { restored: boolean }): void {
  if (window.isDestroyed() || !hasNormalSize(window)) return
  const bounds = window.getBounds()
  const display = screen.getDisplayMatching(bounds)
  const near = (value: number, filled: number): boolean => Math.abs(value - filled) <= FILL_TOLERANCE
  const fills = (area: Rectangle): boolean => near(bounds.x, area.x) && near(bounds.y, area.y)
    && near(bounds.width, area.width) && near(bounds.height, area.height)
  if (fills(display.workArea) || fills(display.bounds)) return
  const last = applied.get(window)
  const belowMinimum = options.restored && (!last || bounds.width < last.shellWidth + last.frame || bounds.height < MIN_WINDOW_HEIGHT)
  if (waiting.has(window) || belowMinimum) applyMainWindowMinimumSize(window, scale)
}
