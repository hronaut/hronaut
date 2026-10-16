import { render, screen, waitFor } from '@testing-library/vue'
import { effectScope } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import PageSnapshot from '../../src/renderer/src/components/PageSnapshot.vue'
import { useOcclusionSnapshotController } from '../../src/renderer/src/composables/useOcclusionSnapshotController.js'
import { holdOverlayEntrance, overlayExitHoldsPage, overlayTransitionHooks, resetOverlayMotion } from '../../src/renderer/src/composables/overlay-motion.js'
import type { BrowserOcclusionSnapshot, HronautShellApi } from '../../src/shared/types.js'

function deferred<T = void>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

const snapshotOf = (id: number, x = 0): BrowserOcclusionSnapshot => ({
  id,
  panes: [{ bounds: { x, y: 104, width: 800, height: 600 }, image: `data:image/jpeg;base64,${id}` }]
})

function fakeShell() {
  let listener: ((snapshot: BrowserOcclusionSnapshot | null) => void) | undefined
  let pagesHiddenListener: (() => void) | undefined
  const unsubscribe = vi.fn()
  const unsubscribePagesHidden = vi.fn()
  const api = {
    onOcclusionSnapshot: vi.fn((next: (snapshot: BrowserOcclusionSnapshot | null) => void) => { listener = next; return unsubscribe }),
    presentOcclusionSnapshot: vi.fn((_id: number) => undefined),
    onOcclusionPagesHidden: vi.fn((next: () => void) => { pagesHiddenListener = next; return unsubscribePagesHidden })
  }
  return {
    api,
    unsubscribe,
    unsubscribePagesHidden,
    send: (snapshot: BrowserOcclusionSnapshot | null) => listener?.(snapshot),
    hidePages: () => pagesHiddenListener?.()
  }
}

function setup(options: Parameters<typeof useOcclusionSnapshotController>[1] = {}) {
  const shell = fakeShell()
  const scope = effectScope()
  const controller = scope.run(() => useOcclusionSnapshotController(shell.api, options))!
  return { ...shell, scope, controller }
}

const flush = () => new Promise<void>(resolve => setTimeout(resolve, 0))

describe('occlusion snapshot controller', () => {
  afterEach(() => { vi.useRealTimers(); resetOverlayMotion() })

  it('lets main hide the pages only after the snapshot has been painted', async () => {
    const paint = deferred()
    const { api, send, controller, scope } = setup({ decode: async () => undefined, afterPaint: () => paint.promise })
    send(snapshotOf(1))
    await flush()
    expect(controller.snapshot.value?.id).toBe(1)
    // Hiding the page views before a frame shows the image would flash the empty window.
    expect(api.presentOcclusionSnapshot).not.toHaveBeenCalled()
    paint.resolve()
    await flush()
    expect(api.presentOcclusionSnapshot).toHaveBeenCalledWith(1)
    scope.stop()
  })

  it('starts held overlay entrances once main can hide the pages', async () => {
    const paint = deferred()
    const { api, send, scope } = setup({ decode: async () => undefined, afterPaint: () => paint.promise })
    holdOverlayEntrance()
    send(snapshotOf(1))
    await flush()
    expect(document.documentElement.hasAttribute('data-overlay-entrance-held')).toBe(true)
    paint.resolve()
    await flush()
    expect(api.presentOcclusionSnapshot).toHaveBeenCalledWith(1)
    expect(document.documentElement.hasAttribute('data-overlay-entrance-held')).toBe(false)

    // An image that cannot be shown lets main hide the pages at once, so the entrance starts too.
    holdOverlayEntrance()
    const failing = setup({ decode: async () => { throw new Error('bad image') }, afterPaint: async () => undefined })
    failing.send(snapshotOf(2))
    await flush()
    expect(document.documentElement.hasAttribute('data-overlay-entrance-held')).toBe(false)
    failing.scope.stop()
    scope.stop()
  })

  it('starts held overlay entrances when main hides the pages without a snapshot', () => {
    const { hidePages, scope, unsubscribePagesHidden } = setup({ decode: async () => undefined, afterPaint: async () => undefined })
    // A sleeping page, or one whose capture missed main's deadline, leaves the screen with no image.
    holdOverlayEntrance()
    hidePages()
    expect(document.documentElement.hasAttribute('data-overlay-entrance-held')).toBe(false)
    scope.stop()
    expect(unsubscribePagesHidden).toHaveBeenCalledOnce()
  })

  it('lets a closing overlay keep the pages hidden only while their snapshot is on screen', async () => {
    const { send, scope } = setup({ decode: async () => undefined, afterPaint: async () => undefined })
    const exit = document.createElement('div')
    // Without an image, holding the pages back would leave the window empty under the exit.
    overlayTransitionHooks.onBeforeLeave(exit)
    expect(overlayExitHoldsPage.value).toBe(false)
    overlayTransitionHooks.onAfterLeave(exit)

    send(snapshotOf(1))
    await flush()
    overlayTransitionHooks.onBeforeLeave(exit)
    expect(overlayExitHoldsPage.value).toBe(true)
    // Main withdraws the image, such as for a tab picked in Search tabs: the page returns at once.
    send(null)
    expect(overlayExitHoldsPage.value).toBe(false)
    overlayTransitionHooks.onAfterLeave(exit)

    send(snapshotOf(2))
    await flush()
    overlayTransitionHooks.onBeforeLeave(exit)
    expect(overlayExitHoldsPage.value).toBe(true)
    scope.stop()
    expect(overlayExitHoldsPage.value).toBe(false)
  })

  it('does not start a newer held entrance for an earlier overlay\'s late snapshot', async () => {
    const paint = deferred()
    const { api, send, scope } = setup({ decode: async () => undefined, afterPaint: () => paint.promise })
    holdOverlayEntrance()
    send(snapshotOf(1))
    await flush()
    // The first dialog closed and another opened while its snapshot was still painting.
    holdOverlayEntrance()
    paint.resolve()
    await flush()
    expect(api.presentOcclusionSnapshot).toHaveBeenCalledWith(1)
    // Main waits on the second dialog's snapshot, so its entrance keeps waiting too.
    expect(document.documentElement.hasAttribute('data-overlay-entrance-held')).toBe(true)
    scope.stop()
  })

  it('ignores a snapshot replaced while its image was still decoding', async () => {
    const decodes: Array<ReturnType<typeof deferred<void>>> = []
    const { api, send, controller, scope } = setup({
      decode: () => { const next = deferred<void>(); decodes.push(next); return next.promise },
      afterPaint: async () => undefined
    })
    send(snapshotOf(1))
    send(null)
    send(snapshotOf(2, 40))
    decodes[0]?.resolve()
    await flush()
    expect(controller.snapshot.value).toBeNull()
    expect(api.presentOcclusionSnapshot).not.toHaveBeenCalled()
    decodes[1]?.resolve()
    await flush()
    expect(controller.snapshot.value?.id).toBe(2)
    expect(api.presentOcclusionSnapshot).toHaveBeenCalledTimes(1)
    expect(api.presentOcclusionSnapshot).toHaveBeenCalledWith(2)
    scope.stop()
  })

  it('keeps the image under the returning pages briefly, and a newer snapshot survives that delay', async () => {
    vi.useFakeTimers()
    const { send, controller, scope } = setup({ decode: async () => undefined, afterPaint: async () => undefined, clearDelayMs: 150 })
    send(snapshotOf(1))
    await vi.advanceTimersByTimeAsync(0)
    send(null)
    await vi.advanceTimersByTimeAsync(100)
    // The page views may not have painted yet; removing the image now would flash on close.
    expect(controller.snapshot.value?.id).toBe(1)
    await vi.advanceTimersByTimeAsync(60)
    expect(controller.snapshot.value).toBeNull()

    send(snapshotOf(2))
    await vi.advanceTimersByTimeAsync(0)
    send(null)
    await vi.advanceTimersByTimeAsync(50)
    send(snapshotOf(3))
    await vi.advanceTimersByTimeAsync(500)
    expect(controller.snapshot.value?.id).toBe(3)
    scope.stop()
  })

  it('uncovers trusted chrome at once when the image cannot be shown', async () => {
    const { api, send, controller, scope } = setup({ decode: async () => { throw new Error('broken image') }, afterPaint: async () => undefined })
    send(snapshotOf(4))
    await flush()
    expect(controller.snapshot.value).toBeNull()
    expect(api.presentOcclusionSnapshot).toHaveBeenCalledWith(4)
    scope.stop()
  })

  it('stops listening and never confirms after disposal', async () => {
    const paint = deferred()
    const { api, send, unsubscribe, scope } = setup({ decode: async () => undefined, afterPaint: () => paint.promise })
    send(snapshotOf(5))
    await flush()
    scope.stop()
    paint.resolve()
    await flush()
    expect(unsubscribe).toHaveBeenCalledOnce()
    expect(api.presentOcclusionSnapshot).not.toHaveBeenCalled()
  })
})

describe('PageSnapshot', () => {
  const original = window.hronautShell
  afterEach(() => {
    window.hronautShell = original
    vi.unstubAllGlobals()
    // jsdom has no image decoding; Chromium's decode is stood in for below.
    delete (HTMLImageElement.prototype as Partial<HTMLImageElement>).decode
  })

  it('draws each page where its hidden view was, hidden from assistive technology and input', async () => {
    const shell = fakeShell()
    window.hronautShell = shell.api as unknown as HronautShellApi
    Object.defineProperty(HTMLImageElement.prototype, 'decode', { configurable: true, value: async () => undefined })
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => setTimeout(() => callback(0), 0))
    render(PageSnapshot)
    shell.send({
      id: 7,
      panes: [
        { bounds: { x: 254, y: 104, width: 700, height: 900 }, image: 'data:image/jpeg;base64,AAAA' },
        { bounds: { x: 962, y: 104, width: 700, height: 900 }, image: 'data:image/jpeg;base64,BBBB' }
      ]
    })
    const container = await screen.findByTestId('page-snapshot')
    expect(container.getAttribute('aria-hidden')).toBe('true')
    const panes = container.querySelectorAll('img')
    expect(panes).toHaveLength(2)
    expect(panes[1]).toHaveStyle({ left: '962px', top: '104px', width: '700px', height: '900px' })
    expect(panes[1]?.getAttribute('alt')).toBe('')
    await waitFor(() => expect(shell.api.presentOcclusionSnapshot).toHaveBeenCalledWith(7))
  })
})
