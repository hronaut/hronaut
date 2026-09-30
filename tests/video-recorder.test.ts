import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { BrowserVideoRecorder, type VideoRecorderHost } from '../src/main/browser/video-recorder.js'
import { VIDEO_LIMITS, videoAnnotationSchema, videoOptionsSchema, validateVideoEdit, videoSourceTime } from '../src/shared/video.js'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())
function fixture() {
  const host = { changed: vi.fn(), render: vi.fn<VideoRecorderHost['render']>(async () => new Uint8Array([1, 2, 3])), save: vi.fn<VideoRecorderHost['save']>(async () => ({ filename: 'video.webm', path: '/downloads/video.webm' })), now: () => Date.now() }
  const recorder = new BrowserVideoRecorder(host)
  const capture = vi.fn(async () => ({ data: new Uint8Array([4, 5, 6]), width: 640, height: 360 }))
  const validate = vi.fn()
  const source = vi.fn()
  const manage = (action: 'get' | 'start' | 'pause' | 'resume' | 'stop' | 'render' | 'export' | 'clear') => recorder.manage('tab', { action }, capture, validate, source)
  return { host, recorder, capture, validate, source, manage }
}

it('excludes paused time, keeps source frames immutable, and exports edited clips', async () => {
  const { recorder, manage, capture, validate, host } = fixture()
  await manage('start')
  await vi.advanceTimersByTimeAsync(1000)
  await manage('pause')
  const paused = recorder.state('tab')
  await vi.advanceTimersByTimeAsync(5000)
  expect(recorder.state('tab')).toEqual(paused)
  await manage('resume')
  await vi.advanceTimersByTimeAsync(1000)
  await manage('stop')
  expect(recorder.state('tab').durationMs).toBe(2000)
  const annotations = [videoAnnotationSchema.parse({ kind: 'text', text: 'Publish', startMs: 200, endMs: 1800, x: 0.1, y: 0.2 })]
  await recorder.manage('tab', { action: 'edit', annotations, clips: [{ startMs: 100, endMs: 500 }, { startMs: 1200, endMs: 1900 }] }, capture, validate)
  const output = await manage('export')
  expect(output.exported).toMatchObject({ mimeType: 'video/webm', codec: 'vp9', durationMs: 1100 })
  expect(host.render).toHaveBeenCalledTimes(1)
  expect(host.render.mock.calls[0]?.[0]).toMatchObject({ annotations })
  await manage('render')
  expect(host.render).toHaveBeenCalledTimes(1)
  await recorder.manage('tab', { action: 'edit', annotations: [] }, capture, validate)
  expect(recorder.state('tab').previewReady).toBe(false)
  await manage('export')
  expect(host.render).toHaveBeenCalledTimes(2)
  recorder.destroy()
})

it('drops an in-flight frame after pause and resume instead of appending it to the new timeline', async () => {
  const { recorder, manage, capture } = fixture()
  await manage('start')
  let release!: (value: { data: Uint8Array<ArrayBuffer>; width: number; height: number }) => void
  capture.mockImplementationOnce(() => new Promise(resolve => { release = resolve }))
  await vi.advanceTimersByTimeAsync(100)
  await manage('pause')
  await manage('resume')
  release({ data: new Uint8Array([99]), width: 640, height: 360 })
  await vi.advanceTimersByTimeAsync(1)
  expect(recorder.state('tab').frameCount).toBe(1)
  recorder.destroy()
})

it('pauses without retaining pixels when authority changes during a capture', async () => {
  const { recorder, manage, capture, validate } = fixture()
  await manage('start')
  capture.mockImplementationOnce(async () => { validate.mockImplementation(() => { throw new Error('revoked') }); return { data: new Uint8Array([99]), width: 640, height: 360 } })
  await vi.advanceTimersByTimeAsync(100)
  expect(recorder.state('tab')).toMatchObject({ status: 'paused', frameCount: 1 })
  recorder.destroy()
})

it('cleans up timers and late captures when a tab closes', async () => {
  const { recorder, manage, capture } = fixture()
  let release!: (value: { data: Uint8Array<ArrayBuffer>; width: number; height: number }) => void
  capture.mockImplementationOnce(() => new Promise(resolve => { release = resolve }))
  const started = manage('start')
  recorder.clear('tab')
  release({ data: new Uint8Array([1]), width: 640, height: 360 })
  await started
  await vi.advanceTimersByTimeAsync(1000)
  expect(recorder.state('tab')).toMatchObject({ status: 'idle', frameCount: 0 })
  expect(capture).toHaveBeenCalledTimes(1)
})

it('rejects concurrent operations and cancels a render on clear before a file can be saved', async () => {
  const { recorder, manage, host } = fixture()
  await manage('start'); await vi.advanceTimersByTimeAsync(100); await manage('stop')
  let release!: (value: Uint8Array) => void
  host.render.mockImplementationOnce(() => new Promise(resolve => { release = resolve }))
  const exporting = manage('export')
  await expect(manage('start')).rejects.toThrow('current video operation')
  await manage('clear')
  release(new Uint8Array([1]))
  await expect(exporting).rejects.toThrow('cancelled')
  expect(host.save).not.toHaveBeenCalled()
  expect(recorder.state('tab').status).toBe('idle')
})

it('bounds memory, duration and number of retained recordings', async () => {
  const { recorder, capture, validate, manage } = fixture()
  capture.mockResolvedValueOnce({ data: new Uint8Array(VIDEO_LIMITS.bytes), width: 640, height: 360 })
  await manage('start'); await vi.advanceTimersByTimeAsync(100)
  expect(recorder.state('tab')).toMatchObject({ status: 'stopped', bytes: VIDEO_LIMITS.bytes, frameCount: 1 })
  await manage('clear'); await manage('start')
  vi.setSystemTime(Date.now() + VIDEO_LIMITS.durationMs)
  await vi.advanceTimersByTimeAsync(100)
  expect(recorder.state('tab').status).toBe('stopped')
  for (const id of ['two', 'three']) { await recorder.manage(id, { action: 'start' }, capture, validate); await recorder.manage(id, { action: 'stop' }, capture, validate) }
  await expect(recorder.manage('four', { action: 'start' }, capture, validate)).rejects.toThrow('maximum three')
  recorder.destroy()
})

it('restricts stored content to its original source context, including cached exports and previews', async () => {
  const { recorder, manage, source, host } = fixture()
  await manage('start'); await vi.advanceTimersByTimeAsync(100); await manage('stop'); await manage('render')
  source.mockImplementation(() => { throw new Error('origin changed') })
  await expect(manage('get')).rejects.toThrow('origin changed')
  await expect(manage('export')).rejects.toThrow('origin changed')
  expect(() => recorder.preview('tab')).toThrow('origin changed')
  expect(host.save).not.toHaveBeenCalled()
  await manage('clear')
})

it('validates timeline boundaries, normalized coordinates and data-only annotations', () => {
  expect(() => videoAnnotationSchema.parse({ kind: 'arrow', startMs: 0, endMs: 100, x: 0, y: 0 })).toThrow()
  expect(() => videoAnnotationSchema.parse({ kind: 'text', text: 'caption', startMs: 0, endMs: 100, x: 2, y: 0 })).toThrow()
  expect(() => videoOptionsSchema.parse({ action: 'edit', script: 'alert(1)' })).toThrow()
  expect(() => validateVideoEdit(1000, [], [{ startMs: 0, endMs: 800 }, { startMs: 500, endMs: 900 }])).toThrow()
  expect(() => validateVideoEdit(1000, [], [{ startMs: 0, endMs: 1100 }])).toThrow()
  expect(videoSourceTime([{ startMs: 500, endMs: 1000 }, { startMs: 1500, endMs: 1800 }], 600)).toBe(1600)
})


it('ignores a late capture failure after stop and keeps stopped recordings terminal', async () => {
  const { recorder, manage, capture } = fixture()
  await manage('start')
  let fail!: (error: Error) => void
  capture.mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject }))
  await vi.advanceTimersByTimeAsync(100)
  await manage('stop')
  fail(new Error('Renderer closed'))
  await vi.advanceTimersByTimeAsync(1)
  expect(recorder.state('tab').status).toBe('stopped')
  await expect(manage('pause')).rejects.toThrow('Stopped recordings cannot resume')
  await expect(manage('resume')).rejects.toThrow('Only a paused recording')
  recorder.destroy()
})

it('validates audio and camera edits atomically and passes soundtrack assets only to the renderer', async () => {
  const { recorder, manage, capture, validate, host } = fixture()
  await manage('start'); await vi.advanceTimersByTimeAsync(1000); await manage('stop')
  const edit = (input: Record<string, unknown>) => recorder.manage('tab', { action: 'edit', ...input }, capture, validate)
  await edit({ audio: [{ assetId: 'builtin:ambient', startMs: 0, endMs: 1000, loop: true }], cameras: [{ startMs: 0, endMs: 900, x: 0.5, y: 0.5 }] })
  const before = recorder.state('tab')
  await expect(edit({ audio: [{ assetId: 'missing', startMs: 0, endMs: 500 }], cameras: [] })).rejects.toThrow('unavailable')
  expect(recorder.state('tab')).toEqual(before)
  await expect(edit({ clips: [{ startMs: 0, endMs: 500 }] })).rejects.toThrow('finished video')
  await expect(edit({ cameras: [{ startMs: 0, endMs: 800, x: 0.5, y: 0.5 }, { startMs: 500, endMs: 1000, x: 0.5, y: 0.5 }] })).rejects.toThrow('non-overlapping')
  const output = await manage('export')
  expect(output.exported?.audioCodec).toBe('opus')
  expect(host.render.mock.calls[0]?.[0]).toMatchObject({ audio: before.audio, cameras: before.cameras })
  await edit({ audio: [], cameras: [] })
  expect(recorder.state('tab').previewReady).toBe(false)
  recorder.destroy()
})

it('discards an import when its recording is cleared or authority is revoked during the read', async () => {
  const { recorder, manage, capture, validate, host } = fixture()
  await manage('start'); await vi.advanceTimersByTimeAsync(100); await manage('stop')
  let finish!: (bytes: Uint8Array) => void
  Object.assign(host, { loadAudio: vi.fn(() => new Promise<Uint8Array>(resolve => { finish = resolve })) })
  const pending = recorder.manage('tab', { action: 'import-audio', audioPath: '/original.wav', audioProvenance: 'Original' }, capture, validate)
  await expect(manage('export')).rejects.toThrow('current video operation')
  await manage('clear')
  finish(new Uint8Array(44))
  await expect(pending).rejects.toThrow('cancelled')
  expect(recorder.state('tab')).toMatchObject({ status: 'idle', audio: [] })
})

it('cancels a request render without caching a late result or discarding the recording', async () => {
  const { recorder, manage, capture, validate, host } = fixture()
  await manage('start'); await vi.advanceTimersByTimeAsync(100); await manage('stop')
  const controller = new AbortController()
  let finish!: (bytes: Uint8Array) => void
  host.render.mockImplementationOnce(async (_plan, _frames, signal) => {
    expect(signal.aborted).toBe(false)
    return new Promise(resolve => { finish = resolve })
  })
  const pending = recorder.manage('tab', { action: 'export' }, capture, validate, validate, controller.signal)
  controller.abort(); finish(new Uint8Array([1]))
  await expect(pending).rejects.toThrow('cancelled')
  expect(host.save).not.toHaveBeenCalled()
  expect(recorder.state('tab')).toMatchObject({ status: 'stopped', previewReady: false })
  await manage('render')
  expect(host.render).toHaveBeenCalledTimes(2)
  recorder.destroy()
})
