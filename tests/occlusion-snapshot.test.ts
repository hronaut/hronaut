import { afterEach, describe, expect, it, vi } from 'vitest'
import { OCCLUSION_SNAPSHOT_TIMEOUT_MS, OcclusionSnapshot, type OcclusionSnapshotImage, type OcclusionSnapshotPorts } from '../src/main/browser/occlusion-snapshot.js'
import { RendererExitedError } from '../src/main/browser/renderer-exit-guard.js'
import type { BrowserOcclusionSnapshot } from '../src/shared/types.js'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}

function image(width = 1600, empty = false) {
  const resized: number[] = []
  const value: OcclusionSnapshotImage = {
    isEmpty: () => empty,
    getSize: () => ({ width, height: 900 }),
    resize: ({ width: next }) => { resized.push(next); return image(next) },
    toJPEG: () => Buffer.from(`jpeg-${width}`)
  }
  return Object.assign(value, { resized })
}

function setup(overrides: Partial<OcclusionSnapshotPorts> = {}) {
  const capture = deferred<OcclusionSnapshotImage>()
  const page = { capturePage: vi.fn((_rect: undefined, _options: { stayHidden: boolean; stayAwake: boolean }) => capture.promise) }
  let layout = 'window-a'
  const sent: Array<BrowserOcclusionSnapshot | null> = []
  const ports: OcclusionSnapshotPorts = {
    panes: () => [{ contents: page, bounds: { x: 250, y: 100, width: 800, height: 450 } }],
    layout: () => layout,
    cssScale: () => 1,
    deviceScale: () => 2,
    send: (snapshot) => { sent.push(snapshot) },
    relayout: vi.fn(),
    pagesHidden: vi.fn(),
    ...overrides
  }
  const snapshot = new OcclusionSnapshot(ports)
  return { snapshot, page, capture, sent, ports, setLayout: (next: string) => { layout = next } }
}

afterEach(() => { vi.useRealTimers() })

describe('occlusion snapshot', () => {
  it('holds the pages on screen until the shell confirms this snapshot', async () => {
    const { snapshot, page, capture, sent, ports } = setup()
    snapshot.begin()
    expect(snapshot.holdingPages).toBe(true)
    // A hidden page must not be woken or counted as visible by the capture.
    expect(page.capturePage).toHaveBeenCalledWith(undefined, { stayHidden: true, stayAwake: false })
    capture.resolve(image(1600))
    await vi.waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0]).toEqual({ id: 1, panes: [{ bounds: { x: 250, y: 100, width: 800, height: 450 }, image: `data:image/jpeg;base64,${Buffer.from('jpeg-1600').toString('base64')}` }] })
    expect(snapshot.holdingPages).toBe(true)
    snapshot.present(99)
    expect(snapshot.holdingPages).toBe(true)
    expect(ports.pagesHidden).not.toHaveBeenCalled()
    snapshot.present(1)
    expect(snapshot.holdingPages).toBe(false)
    expect(ports.relayout).toHaveBeenCalledOnce()
    // The shell starts overlay entrances held back until the pages are off the screen.
    expect(ports.pagesHidden).toHaveBeenCalledOnce()
    snapshot.end()
    expect(sent).toEqual([sent[0], null])
  })

  it('says the pages are off the screen again when asked, unless they still wait for their snapshot', async () => {
    const { snapshot, capture, sent, ports } = setup()
    snapshot.begin()
    snapshot.confirmPagesHidden()
    expect(ports.pagesHidden).not.toHaveBeenCalled()
    capture.resolve(image(1600))
    await vi.waitFor(() => expect(sent).toHaveLength(1))
    snapshot.present(1)
    expect(ports.pagesHidden).toHaveBeenCalledOnce()
    snapshot.confirmPagesHidden()
    expect(ports.pagesHidden).toHaveBeenCalledTimes(2)
  })

  it('keeps device pixels on high-density screens and only shrinks larger captures', async () => {
    const sharp = setup({ deviceScale: () => 2 })
    const exact = image(1600)
    sharp.snapshot.begin()
    sharp.capture.resolve(exact)
    await vi.waitFor(() => expect(sharp.sent).toHaveLength(1))
    expect(exact.resized).toEqual([])

    const oversized = setup({ deviceScale: () => 1, cssScale: () => 1.25 })
    const large = image(1600)
    oversized.snapshot.begin()
    oversized.capture.resolve(large)
    await vi.waitFor(() => expect(oversized.sent).toHaveLength(1))
    expect(large.resized).toEqual([800])
    expect(oversized.sent[0]?.panes[0]?.bounds).toEqual({ x: 200, y: 80, width: 640, height: 360 })
  })

  it('uncovers trusted chrome at the deadline when the shell never confirms', async () => {
    vi.useFakeTimers()
    const { snapshot, ports } = setup()
    snapshot.begin()
    await vi.advanceTimersByTimeAsync(OCCLUSION_SNAPSHOT_TIMEOUT_MS - 1)
    expect(snapshot.holdingPages).toBe(true)
    expect(ports.pagesHidden).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(snapshot.holdingPages).toBe(false)
    expect(ports.relayout).toHaveBeenCalledOnce()
    expect(ports.pagesHidden).toHaveBeenCalledOnce()
  })

  it('drops a capture that finishes after the dialog closed or the layout changed', async () => {
    const closed = setup()
    closed.snapshot.begin()
    closed.snapshot.end()
    closed.capture.resolve(image())
    await Promise.resolve()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(closed.sent).toEqual([])
    // The pages came back instead of leaving the screen.
    expect(closed.ports.pagesHidden).not.toHaveBeenCalled()

    const moved = setup()
    moved.snapshot.begin()
    moved.setLayout('window-b')
    moved.capture.resolve(image())
    await vi.waitFor(() => expect(moved.ports.relayout).toHaveBeenCalledOnce())
    expect(moved.sent).toEqual([])
    expect(moved.snapshot.active).toBe(false)
  })

  it('withdraws a shown snapshot when the window layout changes', async () => {
    const { snapshot, capture, sent, setLayout } = setup()
    snapshot.begin()
    capture.resolve(image())
    await vi.waitFor(() => expect(sent).toHaveLength(1))
    snapshot.present(1)
    snapshot.reconcile()
    expect(sent).toHaveLength(1)
    setLayout('window-b')
    snapshot.reconcile()
    expect(sent).toEqual([sent[0], null])
    expect(snapshot.active).toBe(false)
  })

  it('never stacks captures on a page whose capture has not settled', async () => {
    vi.useFakeTimers()
    const { snapshot, page, ports } = setup()
    snapshot.begin()
    snapshot.end()
    snapshot.begin()
    expect(page.capturePage).toHaveBeenCalledOnce()
    expect(snapshot.holdingPages).toBe(false)
    expect(ports.pagesHidden).toHaveBeenCalledOnce()
  })

  it('uncovers trusted chrome at once when the capture fails or is empty', async () => {
    const failed = setup()
    failed.snapshot.begin()
    failed.capture.reject(new Error('renderer gone'))
    await vi.waitFor(() => expect(failed.ports.relayout).toHaveBeenCalledOnce())
    expect(failed.sent).toEqual([])
    expect(failed.ports.pagesHidden).toHaveBeenCalledOnce()

    const empty = setup()
    empty.snapshot.begin()
    empty.capture.resolve(image(1600, true))
    await vi.waitFor(() => expect(empty.ports.relayout).toHaveBeenCalledOnce())
    expect(empty.sent).toEqual([])
    expect(empty.ports.pagesHidden).toHaveBeenCalledOnce()
  })

  it('keeps the healthy pane of a split view when the other pane has crashed', async () => {
    const crashed = { capturePage: vi.fn(() => Promise.reject(new RendererExitedError(false))) }
    const healthy = deferred<OcclusionSnapshotImage>()
    const { snapshot, sent, ports } = setup({
      panes: () => [
        { contents: crashed, bounds: { x: 0, y: 100, width: 400, height: 450 } },
        { contents: { capturePage: vi.fn(() => healthy.promise) }, bounds: { x: 400, y: 100, width: 400, height: 450 } }
      ]
    })
    snapshot.begin()
    healthy.resolve(image(800))
    await vi.waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0]?.panes.map(pane => pane.bounds.x)).toEqual([400])
    expect(ports.relayout).not.toHaveBeenCalled()
  })

  it('captures a page right after its tab preview capture settles, not instead of it', async () => {
    const preview = deferred<void>()
    const { snapshot, page, capture, sent, ports } = setup()
    const pane = ports.panes()[0]!
    ports.panes = () => [{ ...pane, busy: preview.promise }]
    snapshot.begin()
    await Promise.resolve()
    // Two native captures of one page must not overlap, and the page stays on screen meanwhile.
    expect(page.capturePage).not.toHaveBeenCalled()
    expect(snapshot.holdingPages).toBe(true)
    preview.resolve()
    await vi.waitFor(() => expect(page.capturePage).toHaveBeenCalledOnce())
    capture.resolve(image(1600))
    await vi.waitFor(() => expect(sent).toHaveLength(1))
    expect(ports.relayout).not.toHaveBeenCalled()

    // A dialog closed while the preview was still running does not capture the page afterwards.
    const late = deferred<void>()
    const closed = setup()
    const closedPane = closed.ports.panes()[0]!
    closed.ports.panes = () => [{ ...closedPane, busy: late.promise }]
    closed.snapshot.begin()
    closed.snapshot.end()
    late.resolve()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(closed.page.capturePage).not.toHaveBeenCalled()
    expect(closed.sent).toEqual([])
  })

  it('reports the pages hidden at once without a page to capture, and clears its deadline on dispose', () => {
    vi.useFakeTimers()
    const none = setup({ panes: () => [] })
    none.snapshot.begin()
    expect(none.snapshot.active).toBe(false)
    // A sleeping or minimized page leaves the screen at once, so held entrances start.
    expect(none.ports.pagesHidden).toHaveBeenCalledOnce()
    const disposed = setup()
    disposed.snapshot.begin()
    disposed.snapshot.dispose()
    expect(vi.getTimerCount()).toBe(0)
  })
})
