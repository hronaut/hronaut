import { describe, expect, it } from 'vitest'
import {
  parseShellTooltipMeasurement,
  parseShellTooltipRequest,
  placeShellTooltip,
  SHELL_TOOLTIP_TEXT_LIMIT
} from '../src/shared/shell-tooltip.js'

const request = {
  id: 3,
  text: 'Open command palette (Ctrl+K)',
  anchor: { x: 1200, y: 8, width: 32, height: 32 },
  placement: 'bottom',
  theme: 'dark'
}

describe('shell tooltip contract', () => {
  it('accepts a well-formed request and copies only its known fields', () => {
    expect(parseShellTooltipRequest({ ...request, extra: '<img onerror>' })).toEqual(request)
  })

  it.each([
    ['a missing id', { ...request, id: 0 }],
    ['blank text', { ...request, text: '  ' }],
    ['text over the limit', { ...request, text: 'x'.repeat(SHELL_TOOLTIP_TEXT_LIMIT + 1) }],
    ['an anchor without a size', { ...request, anchor: { x: 1, y: 1 } }],
    ['a non-finite anchor', { ...request, anchor: { ...request.anchor, x: Number.NaN } }],
    ['an unknown placement', { ...request, placement: 'center' }],
    ['the system theme, which the shell resolves first', { ...request, theme: 'system' }],
    ['an array', [request]]
  ])('rejects %s', (_case, value) => {
    expect(() => parseShellTooltipRequest(value)).toThrow('Invalid tooltip request')
  })

  it('ignores measurements that are not a positive size for a request', () => {
    expect(parseShellTooltipMeasurement({ id: 3, width: 120.5, height: 22 })).toEqual({ id: 3, width: 120.5, height: 22 })
    expect(parseShellTooltipMeasurement({ id: 3, width: 0, height: 22 })).toBeNull()
    expect(parseShellTooltipMeasurement({ id: -1, width: 10, height: 22 })).toBeNull()
    expect(parseShellTooltipMeasurement('3x22')).toBeNull()
  })
})

describe('shell tooltip placement', () => {
  const area = { width: 1400, height: 900 }
  const size = { width: 120, height: 24 }

  it('centres a tooltip on the requested side of its control', () => {
    expect(placeShellTooltip({ x: 600, y: 8, width: 32, height: 32 }, size, 'bottom', area)).toEqual({ x: 556, y: 46, width: 120, height: 24 })
    expect(placeShellTooltip({ x: 0, y: 400, width: 56, height: 40 }, size, 'right', area)).toEqual({ x: 62, y: 408, width: 120, height: 24 })
  })

  it('moves to the opposite side when the requested one has no room', () => {
    // A control in the status bar at the bottom of the window shows its tooltip above itself.
    expect(placeShellTooltip({ x: 600, y: 870, width: 32, height: 24 }, size, 'bottom', area).y).toBe(870 - 6 - 24)
    expect(placeShellTooltip({ x: 600, y: 4, width: 32, height: 24 }, size, 'top', area).y).toBe(4 + 24 + 6)
  })

  it('slides along the edge to stay inside the window', () => {
    // The window controls corner: the tooltip of the rightmost toolbar button ends 4 px from the edge.
    expect(placeShellTooltip({ x: 1380, y: 8, width: 20, height: 32 }, size, 'bottom', area).x).toBe(1400 - 4 - 120)
    expect(placeShellTooltip({ x: 0, y: 8, width: 20, height: 32 }, size, 'bottom', area).x).toBe(4)
  })
})
