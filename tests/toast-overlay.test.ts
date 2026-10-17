import { describe, expect, it, vi } from 'vitest'
import { ToastOverlay, placeToastOverlay, toastOverlayWidth, type ToastOverlayLayout, type ToastOverlaySurface } from '../src/main/toast-overlay.js'
import {
  parseToastOverlayMeasurement,
  parseToastOverlayMessage,
  parseToastOverlayRequest,
  type ToastOverlayEvent,
  type ToastOverlayRequest,
  type ToastOverlayState
} from '../src/shared/toast-overlay.js'

function request(id = 1, overrides: Partial<ToastOverlayRequest> = {}): ToastOverlayRequest {
  return {
    toast: { id, tone: 'success', title: 'Tab closed', message: 'Example Domain', action: { label: 'Undo' } },
    focus: null,
    theme: 'dark',
    ...overrides
  }
}

describe('toast overlay contracts', () => {
  it('accepts a toast within the shell limits and refuses anything else', () => {
    expect(parseToastOverlayRequest(request())).toEqual(request())
    expect(parseToastOverlayRequest({ toast: null, focus: 'dismiss', theme: 'light' })).toEqual({ toast: null, focus: null, theme: 'light' })
    const withoutAction = { id: 2, tone: 'error' as const, title: 'Reload failed', message: '' }
    expect(parseToastOverlayRequest({ toast: withoutAction, focus: 'dismiss', theme: 'sepia' }).toast).toEqual(withoutAction)
    const bad: unknown[] = [
      null,
      { ...request(), theme: 'system' },
      { ...request(), toast: { ...request().toast, id: 0 } },
      { ...request(), toast: { ...request().toast, id: 1.5 } },
      { ...request(), toast: { ...request().toast, tone: 'warning' } },
      { ...request(), toast: { ...request().toast, title: 't'.repeat(121) } },
      { ...request(), toast: { ...request().toast, message: 'm'.repeat(1_001) } },
      { ...request(), toast: { ...request().toast, message: 42 } },
      { ...request(), toast: { ...request().toast, action: { label: ' ' } } },
      { ...request(), toast: { ...request().toast, action: { label: 'u'.repeat(41) } } },
      { ...request(), toast: { ...request().toast, action: 'Undo' } },
      { ...request(), focus: 'page' },
      // Only a toast with an action has an action button to focus.
      { toast: withoutAction, focus: 'action', theme: 'dark' }
    ]
    for (const value of bad) expect(() => parseToastOverlayRequest(value)).toThrow(TypeError)
  })

  it('reads only well-formed measurements and messages from the view', () => {
    expect(parseToastOverlayMeasurement({ revision: 3, height: 42.5 })).toEqual({ revision: 3, height: 42.5 })
    for (const value of [null, { revision: 0, height: 40 }, { revision: 1, height: 0 }, { revision: 1, height: Number.POSITIVE_INFINITY }, { revision: 1, height: 10_001 }]) {
      expect(parseToastOverlayMeasurement(value)).toBeNull()
    }
    for (const kind of ['act', 'dismiss', 'retain', 'release'] as const) expect(parseToastOverlayMessage({ id: 4, kind })).toEqual({ id: 4, kind })
    for (const value of [null, { id: 0, kind: 'act' }, { id: 4, kind: 'shown' }, { id: 4, kind: 'eval' }]) {
      expect(parseToastOverlayMessage(value)).toBeNull()
    }
  })
})

describe('toast overlay placement', () => {
  it('is at most 560 px wide, 16 px in from the page area sides, and gives up below 160 px', () => {
    expect(toastOverlayWidth(1280)).toBe(560)
    expect(toastOverlayWidth(500)).toBe(468)
    expect(toastOverlayWidth(192)).toBe(160)
    expect(toastOverlayWidth(191)).toBe(0)
  })

  it('centers the toast at the bottom of the page area with room for its shadow', () => {
    // A page area below a 96 px toolbar, beside a 248 px rail, in a 1320 x 900 window.
    expect(placeToastOverlay({ x: 248, y: 96, width: 1072, height: 804 }, { width: 560, height: 40 }, 16, 10))
      .toEqual({ x: 248 + 256 - 10, y: 900 - 16 - 40 - 10, width: 580, height: 60 })
  })
})

interface Harness {
  overlay: ToastOverlay
  surface: ToastOverlaySurface & { sent: ToastOverlayState[]; bounds: Array<{ x: number; y: number; width: number; height: number }>; presented: number; withdrawn: number; destroyed: boolean }
  events: ToastOverlayEvent[]
  layout: { current: ToastOverlayLayout | null }
  focus: { owner: unknown; restored: unknown[] }
  flush: () => Promise<void>
  resolveSurface: { fail: boolean }
}

function harness(): Harness {
  const surface: Harness['surface'] = {
    sent: [],
    bounds: [],
    presented: 0,
    withdrawn: 0,
    destroyed: false,
    send(state) { this.sent.push(state) },
    setZoomFactor: vi.fn(),
    setBounds(bounds) { this.bounds.push(bounds) },
    present() { this.presented += 1 },
    withdraw() { this.withdrawn += 1 },
    isDestroyed() { return this.destroyed }
  }
  const events: ToastOverlayEvent[] = []
  const layout: Harness['layout'] = { current: { area: { x: 0, y: 100, width: 1000, height: 700 }, zoom: 1 } }
  const focus: Harness['focus'] = { owner: 'page', restored: [] }
  const resolveSurface = { fail: false }
  const overlay = new ToastOverlay({
    surface: async () => {
      if (resolveSurface.fail) throw new Error('view failed to load')
      return surface
    },
    layout: () => layout.current,
    emit: (event) => events.push(event),
    focusOwner: () => focus.owner,
    restoreFocus: (owner) => focus.restored.push(owner)
  })
  return { overlay, surface, events, layout, focus, flush: () => new Promise((resolve) => setTimeout(resolve, 0)), resolveSurface }
}

describe('ToastOverlay', () => {
  it('lays the toast out at its width, places it once measured and tells the shell it shows', async () => {
    const { overlay, surface, events, flush } = harness()
    overlay.show(request(1))
    await flush()
    expect(surface.sent).toEqual([{ revision: 1, toast: request(1).toast, focus: null, theme: 'dark', width: 560 }])
    expect(surface.presented).toBe(0)
    overlay.measured({ revision: 1, height: 42 })
    expect(surface.bounds).toEqual([{ x: 210, y: 100 + 700 - 16 - 42 - 10, width: 580, height: 62 }])
    expect(surface.presented).toBe(1)
    expect(events).toEqual([{ id: 1, kind: 'shown' }])
    expect(overlay.shownId).toBe(1)
    // A view never covers more than a toast's largest box, whatever it reports.
    overlay.measured({ revision: 1, height: 900 })
    expect(surface.bounds.at(-1)?.height).toBe(64 + 20)
    expect(events).toHaveLength(1)
  })

  it('scales the box with the shell zoom', async () => {
    const { overlay, surface, layout, flush } = harness()
    layout.current = { area: { x: 0, y: 150, width: 1500, height: 1050 }, zoom: 1.5 }
    overlay.show(request(1))
    await flush()
    expect(surface.setZoomFactor).toHaveBeenCalledWith(1.5)
    expect(surface.sent[0]?.width).toBe(560)
    overlay.measured({ revision: 1, height: 40 })
    expect(surface.bounds).toEqual([{ x: 750 - 420 - 15, y: 150 + 1050 - 24 - 60 - 15, width: 870, height: 90 }])
  })

  it('drops a measurement of an older layout, and of a toast that has gone', async () => {
    const { overlay, surface, events, flush } = harness()
    overlay.show(request(1))
    await flush()
    overlay.show(request(1, { focus: 'action' }))
    await flush()
    overlay.measured({ revision: 1, height: 40 })
    expect(surface.presented).toBe(0)
    overlay.measured({ revision: 2, height: 40 })
    expect(surface.presented).toBe(1)
    overlay.hide()
    expect(surface.withdrawn).toBe(1)
    overlay.measured({ revision: 2, height: 40 })
    expect(surface.presented).toBe(1)
    expect(events).toEqual([{ id: 1, kind: 'shown' }])
  })

  it('replaces the shown toast in place and reports the new one once measured', async () => {
    const { overlay, surface, events, flush } = harness()
    overlay.show(request(1))
    await flush()
    overlay.measured({ revision: 1, height: 40 })
    overlay.show(request(2, { toast: { id: 2, tone: 'info', title: 'Bookmark removed', message: '' } }))
    await flush()
    // Nothing blinks: the view stays while it draws the new toast.
    expect(surface.withdrawn).toBe(0)
    expect(overlay.shownId).toBe(2)
    expect(events).toEqual([{ id: 1, kind: 'shown' }])
    overlay.measured({ revision: 2, height: 36 })
    expect(events).toEqual([{ id: 1, kind: 'shown' }, { id: 2, kind: 'shown' }])
    // A click on the old toast that was on its way is not the new one's.
    overlay.received({ id: 1, kind: 'act' })
    expect(events).toHaveLength(2)
  })

  it('returns clicks and hover on the shown toast only, and an action only when the toast has one', async () => {
    const { overlay, events, flush } = harness()
    overlay.show(request(1))
    overlay.received({ id: 1, kind: 'act' })
    expect(events).toEqual([])
    await flush()
    overlay.measured({ revision: 1, height: 40 })
    for (const kind of ['retain', 'release', 'act', 'dismiss'] as const) overlay.received({ id: 1, kind })
    overlay.received({ id: 9, kind: 'dismiss' })
    expect(events.slice(1)).toEqual([{ id: 1, kind: 'retain' }, { id: 1, kind: 'release' }, { id: 1, kind: 'act' }, { id: 1, kind: 'dismiss' }])
    overlay.show(request(1, { toast: { id: 1, tone: 'error', title: 'Reload failed', message: '' } }))
    await flush()
    overlay.received({ id: 1, kind: 'act' })
    expect(events).toHaveLength(5)
  })

  it('moves with the page area, lays out again at a new width, and hands the toast to the shell where it does not fit', async () => {
    const { overlay, surface, events, layout, flush } = harness()
    overlay.show(request(1))
    await flush()
    overlay.measured({ revision: 1, height: 40 })
    // A taller window: same width, so the toast just moves down.
    layout.current = { area: { x: 0, y: 100, width: 1000, height: 900 }, zoom: 1 }
    overlay.relayout()
    expect(surface.bounds.at(-1)).toEqual({ x: 210, y: 100 + 900 - 16 - 40 - 10, width: 580, height: 60 })
    expect(surface.sent).toHaveLength(1)
    // A narrower one: laid out again at the new width before it moves.
    layout.current = { area: { x: 240, y: 100, width: 400, height: 900 }, zoom: 1 }
    overlay.relayout()
    await flush()
    expect(surface.sent.at(-1)).toMatchObject({ revision: 2, width: 368 })
    overlay.measured({ revision: 2, height: 52 })
    expect(surface.bounds.at(-1)).toEqual({ x: 240 + 16 - 10, y: 100 + 900 - 16 - 52 - 10, width: 388, height: 72 })
    // Too narrow for a toast: it goes, and the shell shows its own copy.
    layout.current = { area: { x: 240, y: 100, width: 180, height: 900 }, zoom: 1 }
    overlay.relayout()
    expect(surface.withdrawn).toBe(1)
    expect(events).toEqual([{ id: 1, kind: 'shown' }, { id: 1, kind: 'unavailable' }])
    overlay.measured({ revision: 2, height: 52 })
    expect(surface.presented).toBe(3)
    // Room again: it comes back.
    layout.current = { area: { x: 240, y: 100, width: 600, height: 900 }, zoom: 1 }
    overlay.relayout()
    await flush()
    overlay.measured({ revision: 3, height: 40 })
    expect(events.at(-1)).toEqual({ id: 1, kind: 'shown' })
  })

  it('tells the shell when the view cannot show the toast', async () => {
    const { overlay, events, layout, resolveSurface, flush } = harness()
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    resolveSurface.fail = true
    overlay.show(request(1))
    await flush()
    expect(events).toEqual([{ id: 1, kind: 'unavailable' }])
    expect(error).toHaveBeenCalled()
    error.mockRestore()
    // Nor while the window has no page area, as before the workspace has loaded.
    layout.current = null
    overlay.show(request(2))
    expect(events.at(-1)).toEqual({ id: 2, kind: 'unavailable' })
    // A request outside the contract hides what shows and hands that toast to the shell.
    overlay.refused(3)
    expect(events.at(-1)).toEqual({ id: 3, kind: 'unavailable' })
  })

  it('hands the toast to the shell when its view goes away', async () => {
    const { overlay, events, surface, flush } = harness()
    overlay.show(request(1))
    await flush()
    overlay.measured({ revision: 1, height: 40 })
    surface.destroyed = true
    overlay.surfaceLost()
    expect(events.at(-1)).toEqual({ id: 1, kind: 'unavailable' })
    expect(overlay.shownId).toBeUndefined()
  })

  it('puts the view back on top only while it shows a toast', async () => {
    const { overlay, surface, flush } = harness()
    overlay.restack()
    overlay.show(request(1))
    await flush()
    overlay.restack()
    expect(surface.presented).toBe(0)
    overlay.measured({ revision: 1, height: 40 })
    overlay.restack()
    expect(surface.presented).toBe(2)
    overlay.shellReset()
    overlay.restack()
    expect(surface.presented).toBe(2)
    expect(surface.withdrawn).toBe(1)
  })

  it('gives keyboard focus back to whoever had it before a click in the toast', () => {
    const { overlay, focus } = harness()
    overlay.viewFocused()
    expect(focus.restored).toEqual([null])
    overlay.pointerActivity()
    // The click itself focuses the view, which the focus owner port leaves out.
    focus.owner = null
    overlay.pointerActivity()
    overlay.viewFocused()
    expect(focus.restored).toEqual([null, 'page'])
    focus.owner = 'shell'
    overlay.pointerActivity()
    overlay.viewFocused()
    expect(focus.restored.at(-1)).toBe('shell')
    overlay.shellReset()
    overlay.viewFocused()
    expect(focus.restored.at(-1)).toBeNull()
  })

  it('does nothing once disposed', async () => {
    const { overlay, surface, events, flush } = harness()
    overlay.show(request(1))
    await flush()
    overlay.measured({ revision: 1, height: 40 })
    overlay.dispose()
    expect(surface.withdrawn).toBe(1)
    overlay.show(request(2))
    await flush()
    overlay.relayout()
    expect(surface.sent).toHaveLength(1)
    expect(events).toEqual([{ id: 1, kind: 'shown' }])
  })
})
