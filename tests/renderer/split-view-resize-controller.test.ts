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
  it('queues double-click reset after the preceding pointer commit acknowledges its revision', async () => {
    const h = harness({ ...initial, ratio: .65 })
    const finish = deferred<SplitDividerGeometry | null>()
    h.api.finish.mockReturnValueOnce(finish.promise)
    h.api.setRatio.mockImplementation(async (revision, ratio) => revision === 2
      ? { ...initial, revision: 3, ratio } : null)
    await flush()
    h.start()
    await flush()
    h.pointer('pointerup', 503)
    h.controller.resetSize()
    expect(h.api.setRatio).not.toHaveBeenCalled()
    const committed = { ...initial, revision: 2, ratio: .65 }
    h.notify(committed)
    finish.resolve(committed)
    await flush()
    expect(h.api.setRatio).toHaveBeenCalledWith(2, .5)
    expect(h.controller.geometry.value?.ratio).toBe(.5)
  })

  it.each(['replacement', 'blur', 'dispose', 'invalidated'])('discards a queued reset after %s while the pointer commit is pending', async change => {
    const h = harness({ ...initial, ratio: .65 })
    const finish = deferred<SplitDividerGeometry | null>()
    h.api.finish.mockReturnValueOnce(finish.promise)
    await flush()
    h.start()
    await flush()
    h.pointer('pointerup', 503)
    h.controller.resetSize()
    const newer = { ...initial, revision: 3, ratio: .7 }
    if (change === 'replacement') h.notify(newer)
    else if (change === 'blur') window.dispatchEvent(new Event('blur'))
    else if (change === 'dispose') h.scope.stop()
    finish.resolve(change === 'invalidated' ? null : { ...initial, revision: 2, ratio: .65 })
    await flush()
    expect(h.api.setRatio).not.toHaveBeenCalled()
    if (change === 'replacement') expect(h.controller.geometry.value).toEqual(newer)
  })

  it.each(['cancel', 'commit', 'blur', 'dispose', 'replacement', 'third-commit'] as const)('retains the preceding pointer-up commit with a queued second drag: %s', async action => {
    const h = harness()
    let authoritative = structuredClone(initial)
    let session: SplitDividerSession | null = null
    let sequence = 0
    const publish = (ratio: number, commit = false) => {
      authoritative = { ...authoritative, ratio, revision: authoritative.revision + Number(commit) }
      h.notify(structuredClone(authoritative))
      return structuredClone(authoritative)
    }
    // Model the bridge contract: begin supersedes an owned preview, updates
    // retain revision, commit advances it, and obsolete tokens cannot finish.
    // The native regression separately exercises the real privileged handler.
    const main = {
      begin(revision: number): SplitDividerSession | null {
        if (revision !== authoritative.revision) return null
        if (session?.geometry.revision === authoritative.revision) publish(session.geometry.ratio)
        session = { token: String(++sequence), geometry: structuredClone(authoritative) }
        return session
      },
      update(token: string, ratio: number): SplitDividerGeometry | null {
        return session?.token === token && session.geometry.revision === authoritative.revision ? publish(ratio) : null
      },
      finish(token: string, commit: boolean, ratio?: number): SplitDividerGeometry | null {
        if (session?.token !== token || session.geometry.revision !== authoritative.revision) return null
        const target = commit ? ratio ?? authoritative.ratio : session.geometry.ratio
        session = null
        return publish(target, commit)
      },
      persistedRatio(ratio: number): number { return session?.geometry.revision === authoritative.revision ? session.geometry.ratio : ratio }
    }
    h.api.begin.mockImplementation(async revision => main.begin(revision))
    h.api.finish.mockImplementation(async (token, commit, ratio) => main.finish(token, commit, ratio))
    const delayed = deferred<SplitDividerGeometry | null>()
    let updateReply: SplitDividerGeometry | null = null
    h.api.update.mockImplementation((token, ratio) => {
      updateReply = main.update(token, ratio)
      return delayed.promise
    })
    await flush()
    h.start()
    await flush()
    h.pointer('pointermove', 623)
    expect(authoritative.ratio).toBe(.62)
    h.pointer('pointerup', 643)
    // The native preview is visible, but the first gesture is still waiting
    // for its update acknowledgement before it can send the final commit.
    h.start(623)
    await flush()
    expect(h.api.begin).toHaveBeenCalledTimes(1)
    if (action === 'blur') window.dispatchEvent(new Event('blur'))
    else if (action === 'dispose') h.scope.stop()
    else if (action === 'replacement') {
      authoritative = { ...authoritative, revision: 3, ratio: .7 }
      h.notify(structuredClone(authoritative))
    } else if (action === 'commit') h.pointer('pointerup', 653)
    else if (action === 'third-commit') {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
      h.start(623)
      h.pointer('pointerup', 663)
    }
    delayed.resolve(updateReply)
    await flush()
    if (action === 'cancel') window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await flush()
    const expected = action === 'replacement' ? .7 : action === 'commit' ? .67 : action === 'third-commit' ? .68 : .64
    expect(authoritative.ratio).toBeCloseTo(expected)
    expect(main.persistedRatio(authoritative.ratio)).toBeCloseTo(expected)
    if (['blur', 'dispose', 'replacement'].includes(action)) expect(h.api.begin).toHaveBeenCalledTimes(1)
  })

  it('rebases early movement against the geometry acknowledged by begin', async () => {
    const h = harness()
    const begin = deferred<SplitDividerSession | null>()
    h.api.begin.mockReturnValueOnce(begin.promise)
    await flush()
    h.start()
    h.pointer('pointermove', 553)
    begin.resolve({ token: 'authoritative', geometry: { ...initial, ratio: .6 } })
    await flush()
    expect(h.api.update).toHaveBeenLastCalledWith('authoritative', .65)
  })

  it('does not let initial fetch overwrite a newer visibility notification', async () => {
    const h = harness(); h.notify(null); await flush(); expect(h.controller.geometry.value).toBeNull()
  })
})
