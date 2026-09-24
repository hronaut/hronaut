import { describe, expect, it, vi } from 'vitest'
import { PreviewCaptureQueue } from '../src/main/browser/preview-capture-queue.js'

function gate() {
  let resolve!: () => void
  let reject!: (error: unknown) => void
  const promise = new Promise<void>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}

interface Frame { sequence: number; label: string }

describe('thumbnail capture queue', () => {
  it('keeps the newest pending frame and serializes other tabs between captures', async () => {
    const held = gate()
    const started: string[] = []
    const queue = new PreviewCaptureQueue<Frame>(async request => {
      started.push(request.label)
      if (request.label === 'first') await held.promise
    })
    const first = queue.run('a', { sequence: 1, label: 'first' })
    const other = queue.run('b', { sequence: 1, label: 'other' })
    queue.run('a', { sequence: 3, label: 'newest' })
    queue.run('a', { sequence: 2, label: 'stale' })
    await Promise.resolve()
    expect(started).toEqual(['first'])
    expect(queue.has('a')).toBe(true)
    held.resolve()
    await Promise.all([first, other])
    expect(started).toEqual(['first', 'other', 'newest'])
    expect(queue.has('a')).toBe(false)
    expect(queue.has('b')).toBe(false)
  })

  it('lets the latest mode replace a pending request at the same document sequence', async () => {
    const held = gate()
    const capture = vi.fn<((request: Frame) => Promise<void>)>().mockImplementationOnce(() => held.promise).mockResolvedValue(undefined)
    const queue = new PreviewCaptureQueue(capture)
    const operation = queue.run('a', { sequence: 1, label: 'visible' })
    queue.run('a', { sequence: 2, label: 'visible' })
    queue.run('a', { sequence: 2, label: 'overview' })
    held.resolve()
    await operation
    expect(capture.mock.calls.map(([request]) => request.label)).toEqual(['visible', 'overview'])
  })

  it('cancels the pending frame without releasing an active capture', async () => {
    const held = gate()
    const capture = vi.fn<((request: Frame) => Promise<void>)>().mockImplementationOnce(() => held.promise).mockResolvedValue(undefined)
    const queue = new PreviewCaptureQueue(capture)
    const operation = queue.run('a', { sequence: 1, label: 'active' })
    queue.run('a', { sequence: 2, label: 'cancelled' })
    queue.cancelPending('a')
    expect(queue.has('a')).toBe(true)
    held.resolve()
    await operation
    expect(capture).toHaveBeenCalledOnce()
  })

  it('attempts a newer frame after an earlier capture fails', async () => {
    const held = gate()
    const capture = vi.fn<((request: Frame) => Promise<void>)>().mockImplementationOnce(() => held.promise).mockResolvedValue(undefined)
    const queue = new PreviewCaptureQueue(capture)
    const operation = queue.run('a', { sequence: 1, label: 'old' })
    queue.run('a', { sequence: 2, label: 'new' })
    await Promise.resolve()
    held.reject(new Error('old document gone'))
    await operation
    expect(capture.mock.calls.map(([request]) => request.label)).toEqual(['old', 'new'])
  })

  it('reports failures without poisoning later captures', async () => {
    const capture = vi.fn<((request: Frame) => Promise<void>)>().mockRejectedValueOnce(new Error('capture failed')).mockResolvedValue(undefined)
    const queue = new PreviewCaptureQueue(capture)
    await expect(queue.run('a', { sequence: 1, label: 'failed' })).rejects.toThrow('capture failed')
    await queue.run('b', { sequence: 1, label: 'later' })
    expect(capture).toHaveBeenCalledTimes(2)
  })

  it('clears pending work without letting old completion consume newer requests', async () => {
    const old = gate()
    const replacement = gate()
    const started: string[] = []
    const queue = new PreviewCaptureQueue<Frame>(async request => {
      started.push(request.label)
      if (request.label === 'old') await old.promise
      if (request.label === 'replacement') await replacement.promise
    })
    const first = queue.run('a', { sequence: 1, label: 'old' })
    queue.run('a', { sequence: 2, label: 'discarded' })
    queue.clear()
    const newer = queue.run('a', { sequence: 3, label: 'replacement' })
    queue.run('a', { sequence: 4, label: 'latest' })
    old.resolve()
    await first
    expect(queue.has('a')).toBe(true)
    replacement.resolve()
    await newer
    expect(started).toEqual(['old', 'replacement', 'latest'])
    expect(queue.has('a')).toBe(false)
  })
})
