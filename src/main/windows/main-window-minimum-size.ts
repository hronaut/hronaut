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

/** Windows whose minimum waits until they have their own size again, as one chosen while they were maximized. */
const waiting = new WeakSet<BrowserWindow>()

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
 * stays on its screen. A maximized, full screen or minimized window gets it once it has its own size again, so its
 * frame is measured at that size and the system never grows it past its screen as it gives the size back.
 */
export function applyMainWindowMinimumSize(window: BrowserWindow, scale: number): void {
  if (!hasNormalSize(window)) {
    waiting.add(window)
    return
  }
  waiting.delete(window)
  const minimum = mainWindowMinimumSize(scale)
  const width = minimum.width + frameWidth(window)
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
 * Applies a minimum that waited, once the window has its own size again. Until the window stops filling its screen's
 * work area or its whole screen, it waits on: a window manager can say a window left maximized before giving it its
 * size back, and the resize that follows applies it then, as it does for a macOS window dragged out of its zoom.
 */
export function applyWaitingMainWindowMinimumSize(window: BrowserWindow, scale: number): void {
  if (window.isDestroyed() || !waiting.has(window) || !hasNormalSize(window)) return
  const bounds = window.getBounds()
  const display = screen.getDisplayMatching(bounds)
  const fills = (area: { x: number; y: number; width: number; height: number }): boolean => bounds.x === area.x && bounds.y === area.y
    && bounds.width === area.width && bounds.height === area.height
  if (fills(display.workArea) || fills(display.bounds)) return
  applyMainWindowMinimumSize(window, scale)
}
