import { effectScope } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useSplitViewResizeController } from '../../src/renderer/src/composables/useSplitViewResizeController.js'
import type { HronautSplitDividerApi, SplitDividerGeometry, SplitDividerSession } from '../../src/shared/split-view.js'

const initial: SplitDividerGeometry = { revision: 1, firstTabId: 'a', secondTabId: 'b', orientation: 'vertical', ratio: .5, bounds: { x: 500, y: 80, width: 12, height: 600 }, area: { x: 0, y: 80, width: 1012, height: 600 }, gap: 12, scale: 1 }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done }); return { promise, resolve } }
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve() }
const cleanup: (() => void)[] = []
afterEach(() => { cleanup.splice(0).forEach(fn => fn()) })
function harness(geometry = initial) {
  let notify!: (next: SplitDividerGeometry | null) => void
  const api = {
    get: vi.fn<HronautSplitDividerApi['get']>(async () => geometry), begin: vi.fn<HronautSplitDividerApi['begin']>(async () => ({ token: 'token', geometry })),
    update: vi.fn<HronautSplitDividerApi['update']>(async (_token, ratio) => ({ ...geometry, ratio })),
    finish: vi.fn<HronautSplitDividerApi['finish']>(async () => geometry), setRatio: vi.fn<HronautSplitDividerApi['setRatio']>(async () => geometry),
    onChanged: vi.fn<HronautSplitDividerApi['onChanged']>(listener => { notify = listener; return vi.fn() })
  }
  const scope = effectScope()
  const controller = scope.run(() => useSplitViewResizeController(api))!
  const handle = document.createElement('div')
  document.body.append(handle)
  let capture = false
  const releasePointerCapture = vi.fn(() => { capture = false })
  Object.assign(handle, { setPointerCapture: vi.fn(() => { capture = true }), hasPointerCapture: () => capture, releasePointerCapture })
  function pointer(type: string, x: number, y = 300, id = 1) { const event = new Event(type); Object.assign(event, { clientX: x, clientY: y, pointerId: id }); window.dispatchEvent(event) }
  const start = (x = 503, y = 300) => controller.startResize({ button: 0, pointerId: 1, clientX: x, clientY: y, currentTarget: handle, preventDefault: vi.fn() } as unknown as PointerEvent)
  cleanup.push(() => { scope.stop(); handle.remove() })
  return { controller, api, start, pointer, handle, releasePointerCapture, notify: (next: SplitDividerGeometry | null) => notify(next), scope }
}

describe('direct split divider resizing', () => {
  it('preserves grab offset, clamps movement and commits the final pointer position', async () => {
    const h = harness(); await flush(); h.start(); await flush()
    h.pointer('pointermove', 553); await flush()
    expect(h.api.update).toHaveBeenLastCalledWith('token', .55)
    h.pointer('pointerup', 900); await flush()
    expect(h.api.finish).toHaveBeenLastCalledWith('token', true, .75)
    expect(h.releasePointerCapture).toHaveBeenCalledWith(1)
  })
  it('coalesces pending moves and serializes final commit after the in-flight update', async () => {
    const h = harness(); const update = deferred<SplitDividerGeometry | null>()
    vi.mocked(h.api.update).mockReturnValueOnce(update.promise)
    await flush(); h.start(); await flush()
    h.pointer('pointermove', 513); h.pointer('pointermove', 523); h.pointer('pointermove', 543)
    expect(h.api.update).toHaveBeenCalledTimes(1)
    update.resolve({ ...initial, ratio: .51 }); await flush()
    expect(h.api.update).toHaveBeenLastCalledWith('token', .54)
    const final = deferred<SplitDividerGeometry | null>(); vi.mocked(h.api.update).mockReturnValueOnce(final.promise)
    h.pointer('pointermove', 553); h.pointer('pointerup', 603)
    expect(h.api.finish).not.toHaveBeenCalled()
    final.resolve({ ...initial, ratio: .55 }); await flush()
    expect(h.api.finish).toHaveBeenCalledWith('token', true, .6)
  })
  it.each(['blur', 'pointercancel', 'lostpointercapture', 'Escape', 'dispose'])('cancels on %s even when begin arrives late', async cause => {
    const h = harness(); const begin = deferred<SplitDividerSession | null>(); vi.mocked(h.api.begin).mockReturnValue(begin.promise)
    await flush(); h.start()
    if (cause === 'dispose') h.scope.stop()
    else if (cause === 'Escape') window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    else if (cause === 'lostpointercapture') h.handle.dispatchEvent(new Event(cause))
    else if (cause === 'pointercancel') h.pointer(cause, 503)
    else window.dispatchEvent(new Event(cause))
    expect(h.controller.resizing.value).toBe(false)
    begin.resolve({ token: 'late', geometry: initial }); await flush()
    expect(h.api.finish).toHaveBeenCalledWith('late', false, undefined)
    expect(h.api.update).not.toHaveBeenCalled()
  })
  it('does not overwrite newer geometry when a canceled update finishes late', async () => {
    const h = harness(); const update = deferred<SplitDividerGeometry | null>(); vi.mocked(h.api.update).mockReturnValue(update.promise)
    await flush(); h.start(); await flush(); h.pointer('pointermove', 550)
    const next = { ...initial, revision: 2, orientation: 'horizontal' as const }
    h.notify(next); update.resolve({ ...initial, ratio: .6 }); await flush()
    expect(h.controller.geometry.value).toEqual(next)
    expect(h.api.finish).toHaveBeenCalledWith('token', false, undefined)
  })
  it('cleans up the owned token when an update rejects during cancellation', async () => {
    const h = harness(); let reject!: (cause: Error) => void
    vi.mocked(h.api.update).mockReturnValue(new Promise((_resolve, fail) => { reject = fail }))
    await flush(); h.start(); await flush(); h.pointer('pointermove', 550)
    window.dispatchEvent(new Event('blur')); reject(new Error('IPC unavailable')); await flush()
    expect(h.api.finish).toHaveBeenCalledWith('token', false)
    expect(h.controller.resizing.value).toBe(false)
  })
  it.each(['area', 'scale'])('cancels same-revision %s changes without moving from stale coordinates', async change => {
    const h = harness(); await flush(); h.start(); await flush()
    const next = change === 'area' ? { ...initial, area: { ...initial.area, width: 800 } } : { ...initial, scale: 1.25 }
    h.notify(next); await flush()
    expect(h.controller.resizing.value).toBe(false)
    expect(h.controller.geometry.value).toEqual(next)
    expect(h.api.finish).toHaveBeenCalledWith('token', false, undefined)
    h.pointer('pointermove', 600)
    expect(h.api.update).not.toHaveBeenCalled()
  })
  it('ignores unrelated pointers and uses vertical coordinates for stacked panes', async () => {
    const h = harness({ ...initial, orientation: 'horizontal', area: { ...initial.area, height: 1012 } }); await flush(); h.start(); await flush()
    h.pointer('pointermove', 503, 350, 2); expect(h.api.update).not.toHaveBeenCalled()
    h.pointer('pointermove', 900, 350); await flush(); expect(h.api.update).toHaveBeenCalledWith('token', .55)
  })
  it('supports axis-specific keyboard steps, bounds and reset with current revision', async () => {
    const h = harness(); await flush()
    const key = (key: string, shiftKey = false) => h.controller.resizeWithKeyboard(new KeyboardEvent('keydown', { key, shiftKey }))
    key('ArrowDown'); expect(h.api.setRatio).not.toHaveBeenCalled()
    key('ArrowRight'); await flush(); expect(h.api.setRatio).toHaveBeenLastCalledWith(1, .51)
    key('ArrowLeft', true); await flush(); expect(h.api.setRatio).toHaveBeenLastCalledWith(1, .45)
    key('Home'); await flush(); expect(h.api.setRatio).toHaveBeenLastCalledWith(1, .25)
    key('End'); await flush(); expect(h.api.setRatio).toHaveBeenLastCalledWith(1, .75)
    key('Enter'); await flush(); expect(h.api.setRatio).toHaveBeenLastCalledWith(1, .5)
  })
  it('accumulates repeated keys and serializes their target against the acknowledged revision', async () => {
    const h = harness(); await flush()
    const first = deferred<SplitDividerGeometry | null>()
    h.api.setRatio.mockReturnValueOnce(first.promise)
    const key = () => h.controller.resizeWithKeyboard(new KeyboardEvent('keydown', { key: 'ArrowRight' }))
    key(); key(); key()
    expect(h.api.setRatio).toHaveBeenCalledTimes(1)
    expect(h.api.setRatio).toHaveBeenCalledWith(1, .51)
    const next = { ...initial, revision: 2, ratio: .51 }
    h.notify(next); first.resolve(next); await flush()
    expect(h.api.setRatio).toHaveBeenCalledTimes(2)
    expect(h.api.setRatio).toHaveBeenLastCalledWith(2, .53)
  })
  it.each(['revision', 'layout', 'blur', 'dispose'])('discards pending keyboard repeats after an external %s change', async change => {
    const h = harness(); await flush()
    const first = deferred<SplitDividerGeometry | null>()
    h.api.setRatio.mockReturnValueOnce(first.promise)
    h.controller.resizeWithKeyboard(new KeyboardEvent('keydown', { key: 'ArrowRight' }))
    h.controller.resizeWithKeyboard(new KeyboardEvent('keydown', { key: 'ArrowRight' }))
    const next = { ...initial, revision: 3, ratio: .7, ...(change === 'layout' ? { orientation: 'horizontal' as const } : {}) }
    if (change === 'blur') window.dispatchEvent(new Event('blur'))
    else if (change === 'dispose') h.scope.stop()
    else h.notify(next)
    first.resolve({ ...initial, revision: 2, ratio: .51 }); await flush()
    expect(h.api.setRatio).toHaveBeenCalledTimes(1)
    if (change === 'revision' || change === 'layout') expect(h.controller.geometry.value).toEqual(next)
  })
  it('does not let initial fetch overwrite a newer visibility notification', async () => {
    const h = harness(); h.notify(null); await flush(); expect(h.controller.geometry.value).toBeNull()
  })
})
