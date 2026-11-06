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

/** The frame a system title bar adds to each window's width, measured while the window has its normal size. */
const frames = new WeakMap<BrowserWindow, number>()
/** Windows narrower than a scale chosen while they were maximized, full screen or minimized, which grow when restored. */
const growOnRestore = new WeakSet<BrowserWindow>()

/** Whether the window has its own size, rather than its screen's or none. */
function hasNormalSize(window: BrowserWindow): boolean {
  return !window.isMaximized() && !window.isFullScreen() && !window.isMinimized()
}

/** The window's frame, measured only at its normal size: maximized or full screen, a frame can shrink or go. */
function frameWidth(window: BrowserWindow): number {
  if (hasNormalSize(window)) {
    const [outerWidth = 0] = window.getSize()
    const [contentWidth = 0] = window.getContentSize()
    frames.set(window, Math.max(0, outerWidth - contentWidth))
  }
  return frames.get(window) ?? 0
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
 * stays on its screen; a maximized, full screen or minimized one grows when it is restored.
 */
export function applyMainWindowMinimumSize(window: BrowserWindow, scale: number): void {
  const minimum = mainWindowMinimumSize(scale)
  const width = minimum.width + frameWidth(window)
  window.setMinimumSize(width, minimum.height)
  if (!hasNormalSize(window)) {
    const normal = window.getNormalBounds()
    if (normal.width < width || normal.height < minimum.height) growOnRestore.add(window)
    return
  }
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
 * Applies the minimum once a window is restored from maximized, full screen or minimized, after the system has given it
 * its size back: Windows says it left full screen before it has. A window the system itself grew to a larger scale's
 * minimum is kept on its screen too.
 */
export function applyMainWindowMinimumSizeOnRestore(window: BrowserWindow, scale: () => number): void {
  setImmediate(() => {
    if (window.isDestroyed() || !hasNormalSize(window)) return
    const grew = growOnRestore.delete(window)
    applyMainWindowMinimumSize(window, scale())
    if (!grew) return
    const bounds = window.getBounds()
    const area = screen.getDisplayMatching(bounds).workArea
    const x = shiftedBack(bounds.x, 0, bounds.width, area.x, area.width)
    if (x !== bounds.x) window.setBounds({ ...bounds, x })
  })
}
