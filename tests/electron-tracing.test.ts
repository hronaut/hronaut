import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { ElectronTraceRecorder } from './integration/electron-tracing.js'

type TraceInfo = ConstructorParameters<typeof ElectronTraceRecorder>[0]

function harness(trace: TraceInfo['project']['use']['trace'] = 'retain-on-failure', retry = 0) {
  const attachments: Array<{ name: string; body: string }> = []
  const paths: string[] = []
  const info: TraceInfo = {
    title: 'Trace lifecycle', retry, status: 'passed', expectedStatus: 'passed',
    project: { use: { trace } },
    attach: vi.fn(async (name, options) => {
      attachments.push({ name, body: options.path ? await readFile(options.path, 'utf8') : String(options.body) })
    })
  }
  const start = vi.fn(async () => {})
  const stop = vi.fn(async (options?: { path?: string }) => {
    if (options?.path) {
      paths.push(options.path)
      await writeFile(options.path, 'recorded page snapshots')
    }
  })
  const app = { context: vi.fn(() => ({ tracing: { start, stop } })) }
  return { info, attachments, paths, app, start, stop, recorder: new ElectronTraceRecorder(info) }
}

describe('Electron failure traces', () => {
  it('honors the resolved test option instead of the project default', async () => {
    const h = harness('on')
    const recorder = new ElectronTraceRecorder(h.info, 'off')
    await recorder.start(h.app)
    h.info.status = 'failed'
    await recorder.finish()
    expect(h.start).not.toHaveBeenCalled()
    expect(h.attachments).toEqual([])
  })

  it('retains an earlier closed application when the test fails after a restart', async () => {
    const h = harness()
    await h.recorder.start(h.app)
    await h.recorder.stop(h.app)
    expect(h.attachments).toEqual([])
    h.info.status = 'failed'
    await h.recorder.finish()
    expect(h.attachments).toEqual([{ name: 'trace', body: 'recorded page snapshots' }])
    expect(h.stop).toHaveBeenCalledTimes(1)
    await expect(access(dirname(h.paths[0]!))).rejects.toThrow()
  })

  it('discards successful traces and cleans temporary archives', async () => {
    const h = harness()
    await h.recorder.start(h.app)
    await h.recorder.finish()
    expect(h.attachments).toEqual([])
    await expect(access(dirname(h.paths[0]!))).rejects.toThrow()
  })

  it.each([
    { mode: 'off', retry: 0, records: false, retains: false },
    { mode: 'on', retry: 0, records: true, retains: true },
    { mode: 'on-first-retry', retry: 0, records: false, retains: false },
    { mode: 'on-first-retry', retry: 1, records: true, retains: true },
    { mode: 'retry-with-trace', retry: 0, records: false, retains: false },
    { mode: 'on-first-retry', retry: 2, records: false, retains: false },
    { mode: 'on-all-retries', retry: 2, records: true, retains: true },
    { mode: 'retain-on-first-failure', retry: 1, records: false, retains: false },
    { mode: 'retain-on-failure-and-retries', retry: 1, records: true, retains: true }
  ] as const)('respects $mode at retry $retry', async ({ mode, retry, records, retains }) => {
    const h = harness(mode, retry)
    await h.recorder.start(h.app)
    await h.recorder.finish()
    expect(h.start).toHaveBeenCalledTimes(records ? 1 : 0)
    expect(h.attachments).toHaveLength(retains ? 1 : 0)
  })

  it('uses the configured snapshot features and discards an expected failure', async () => {
    const h = harness({ mode: 'retain-on-failure', screenshots: false, snapshots: { aria: true }, sources: false })
    h.info.status = h.info.expectedStatus = 'failed'
    await h.recorder.start(h.app)
    await h.recorder.finish()
    expect(h.start).toHaveBeenCalledWith({ title: 'Trace lifecycle', screenshots: false, snapshots: { aria: true }, sources: false })
    expect(h.attachments).toEqual([])
  })

  it('does not mask the original failure if the Electron context has already closed', async () => {
    const h = harness()
    await h.recorder.start(h.app)
    h.app.context.mockImplementation(() => { throw new Error('Application closed') })
    h.info.status = 'failed'
    await expect(h.recorder.finish()).resolves.toBeUndefined()
    expect(h.attachments).toEqual([{ name: 'electron-trace-errors', body: expect.stringContaining('Application closed') }])
  })

  it('shares one cleanup directory for applications started concurrently and stops each once', async () => {
    const h = harness('on')
    const second = { context: h.app.context }
    await Promise.all([h.recorder.start(h.app), h.recorder.start(second)])
    await Promise.all([h.recorder.stop(h.app), h.recorder.finish()])
    await h.recorder.finish()
    expect(h.stop).toHaveBeenCalledTimes(2)
    expect(h.attachments).toHaveLength(2)
    expect(new Set(h.paths.map(dirname)).size).toBe(1)
    for (const path of h.paths) await expect(access(dirname(path))).rejects.toThrow()
  })

  it('bounds an unresponsive export and removes an archive that arrives after cleanup', async () => {
    const h = harness()
    await h.recorder.start(h.app)
    let release!: () => void
    const resume = new Promise<void>(resolve => { release = resolve })
    let lateWrite: Promise<void> | undefined
    h.stop.mockImplementation(options => {
      const path = options!.path!
      h.paths.push(path)
      lateWrite = resume.then(async () => {
        await mkdir(dirname(path), { recursive: true })
        await writeFile(path, 'late snapshot archive')
      })
      return lateWrite
    })
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      const stopping = h.recorder.stop(h.app)
      await vi.advanceTimersByTimeAsync(5_001)
      await stopping
      h.info.status = 'failed'
      await h.recorder.finish()
      expect(h.attachments).toEqual([{ name: 'electron-trace-errors', body: expect.stringContaining('cleanup deadline') }])
    } finally {
      vi.useRealTimers()
      release()
      await lateWrite
    }
    await vi.waitFor(async () => { await expect(access(dirname(h.paths[0]!))).rejects.toThrow() })
  })
})
