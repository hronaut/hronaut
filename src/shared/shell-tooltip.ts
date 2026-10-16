import { isResolvedThemeName, type ResolvedThemeName } from './theme.js'

export const SHELL_TOOLTIP_PLACEMENTS = ['top', 'right', 'bottom', 'left'] as const
export type ShellTooltipPlacement = typeof SHELL_TOOLTIP_PLACEMENTS[number]

/** Longest tooltip text the shell may send; tab tooltips carry a title, an address and a workspace description. */
export const SHELL_TOOLTIP_TEXT_LIMIT = 2_000
/** Space between a control and its tooltip, and between a tooltip and the window edge, in CSS pixels. */
export const SHELL_TOOLTIP_GAP = 6
export const SHELL_TOOLTIP_EDGE = 4
/** Transparent room the tooltip view keeps around the tooltip for its shadow, in CSS pixels. */
export const SHELL_TOOLTIP_SHADOW_ROOM = 4
/**
 * Largest tooltip main draws, in CSS pixels. The tooltip view caps its box at 320 px wide and
 * 12 lines (tooltip-overlay.css); main clamps a larger report so the view never covers the window.
 */
export const SHELL_TOOLTIP_MAX_WIDTH = 320
export const SHELL_TOOLTIP_MAX_HEIGHT = 240

export interface ShellTooltipRect {
  x: number
  y: number
  width: number
  height: number
}

/** Sent by the shell: the control's box in its viewport, in CSS pixels. */
export interface ShellTooltipRequest {
  id: number
  text: string
  anchor: ShellTooltipRect
  placement: ShellTooltipPlacement
  theme: ResolvedThemeName
}

/** Sent to the tooltip view, which reports its measured size for the same id. */
export interface ShellTooltipState {
  id: number
  text: string
  theme: ResolvedThemeName
}

export interface ShellTooltipMeasurement {
  id: number
  width: number
  height: number
}

function finiteNumber(value: unknown, minimum: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= 100_000
}

function validId(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0
}

export function parseShellTooltipRequest(value: unknown): ShellTooltipRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Invalid tooltip request')
  const request = value as Record<string, unknown>
  const anchor = request.anchor as Record<string, unknown> | null | undefined
  if (
    !validId(request.id)
    || typeof request.text !== 'string'
    || request.text.trim().length === 0
    || request.text.length > SHELL_TOOLTIP_TEXT_LIMIT
    || !anchor || typeof anchor !== 'object' || Array.isArray(anchor)
    || !finiteNumber(anchor.x, -100_000) || !finiteNumber(anchor.y, -100_000)
    || !finiteNumber(anchor.width, 0) || !finiteNumber(anchor.height, 0)
    || !(SHELL_TOOLTIP_PLACEMENTS as readonly unknown[]).includes(request.placement)
    || !isResolvedThemeName(request.theme)
  ) throw new TypeError('Invalid tooltip request')
  return {
    id: request.id,
    text: request.text,
    anchor: { x: anchor.x, y: anchor.y, width: anchor.width, height: anchor.height },
    placement: request.placement as ShellTooltipPlacement,
    theme: request.theme
  }
}

export function parseShellTooltipMeasurement(value: unknown): ShellTooltipMeasurement | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const measurement = value as Record<string, unknown>
  if (!validId(measurement.id) || !finiteNumber(measurement.width, 1) || !finiteNumber(measurement.height, 1)) return null
  return { id: measurement.id, width: measurement.width, height: measurement.height }
}

function opposite(placement: ShellTooltipPlacement): ShellTooltipPlacement {
  return ({ top: 'bottom', bottom: 'top', left: 'right', right: 'left' } as const)[placement]
}

function origin(anchor: ShellTooltipRect, size: { width: number; height: number }, placement: ShellTooltipPlacement, gap: number) {
  switch (placement) {
    case 'top': return { x: anchor.x + (anchor.width - size.width) / 2, y: anchor.y - gap - size.height }
    case 'bottom': return { x: anchor.x + (anchor.width - size.width) / 2, y: anchor.y + anchor.height + gap }
    case 'left': return { x: anchor.x - gap - size.width, y: anchor.y + (anchor.height - size.height) / 2 }
    case 'right': return { x: anchor.x + anchor.width + gap, y: anchor.y + (anchor.height - size.height) / 2 }
  }
}

function fits(point: { x: number; y: number }, size: { width: number; height: number }, area: { width: number; height: number }, placement: ShellTooltipPlacement, edge: number): boolean {
  return placement === 'top' || placement === 'bottom'
    ? point.y >= edge && point.y + size.height <= area.height - edge
    : point.x >= edge && point.x + size.width <= area.width - edge
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), Math.max(minimum, maximum))
}

/**
 * Places a tooltip of `size` beside `anchor` inside a window `area`, all in one unit: on the
 * requested side, on the opposite side when that one has no room, and slid along the edge so it
 * stays inside the window. Returns null when it fits on neither side: the native view takes the
 * pointer, so it must never cover the control it describes.
 */
export function placeShellTooltip(
  anchor: ShellTooltipRect,
  size: { width: number; height: number },
  placement: ShellTooltipPlacement,
  area: { width: number; height: number },
  { gap = SHELL_TOOLTIP_GAP, edge = SHELL_TOOLTIP_EDGE } = {}
): ShellTooltipRect | null {
  let point = origin(anchor, size, placement, gap)
  if (!fits(point, size, area, placement, edge)) {
    point = origin(anchor, size, opposite(placement), gap)
    if (!fits(point, size, area, opposite(placement), edge)) return null
  }
  return {
    x: Math.round(clamp(point.x, edge, area.width - edge - size.width)),
    y: Math.round(clamp(point.y, edge, area.height - edge - size.height)),
    width: Math.ceil(size.width),
    height: Math.ceil(size.height)
  }
}
