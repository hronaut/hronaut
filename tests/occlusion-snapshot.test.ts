import { afterEach, describe, expect, it, vi } from 'vitest'
import { OCCLUSION_SNAPSHOT_TIMEOUT_MS, OcclusionSnapshot, type OcclusionSnapshotImage, type OcclusionSnapshotPorts } from '../src/main/browser/occlusion-snapshot.js'
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
    snapshot.present(1)
    expect(snapshot.holdingPages).toBe(false)
    expect(ports.relayout).toHaveBeenCalledOnce()
    snapshot.end()
    expect(sent).toEqual([sent[0], null])
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
    await vi.advanceTimersByTimeAsync(1)
    expect(snapshot.holdingPages).toBe(false)
    expect(ports.relayout).toHaveBeenCalledOnce()
  })

  it('drops a capture that finishes after the dialog closed or the layout changed', async () => {
    const closed = setup()
    closed.snapshot.begin()
    closed.snapshot.end()
    closed.capture.resolve(image())
    await Promise.resolve()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(closed.sent).toEqual([])

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
    const { snapshot, page } = setup()
    snapshot.begin()
    snapshot.end()
    snapshot.begin()
    expect(page.capturePage).toHaveBeenCalledOnce()
    expect(snapshot.holdingPages).toBe(false)
  })

  it('uncovers trusted chrome at once when the capture fails or is empty', async () => {
    const failed = setup()
    failed.snapshot.begin()
    failed.capture.reject(new Error('renderer gone'))
    await vi.waitFor(() => expect(failed.ports.relayout).toHaveBeenCalledOnce())
    expect(failed.sent).toEqual([])

    const empty = setup()
    empty.snapshot.begin()
    empty.capture.resolve(image(1600, true))
    await vi.waitFor(() => expect(empty.ports.relayout).toHaveBeenCalledOnce())
    expect(empty.sent).toEqual([])
  })

  it('does nothing without a page to capture, and clears its deadline on dispose', () => {
    vi.useFakeTimers()
    const none = setup({ panes: () => [] })
    none.snapshot.begin()
    expect(none.snapshot.active).toBe(false)
    const disposed = setup()
    disposed.snapshot.begin()
    disposed.snapshot.dispose()
    expect(vi.getTimerCount()).toBe(0)
  })
})
