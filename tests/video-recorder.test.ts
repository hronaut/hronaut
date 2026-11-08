import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { BrowserVideoRecorder, type VideoCaptureResult, type VideoRecorderHost } from '../src/main/browser/video-recorder.js'
import { VIDEO_LIMITS, VIDEO_RECORDING_NOTICES, videoAnnotationSchema, videoOptionsSchema, validateVideoEdit, videoSourceTime } from '../src/shared/video.js'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())
function fixture() {
  const host = { changed: vi.fn(), render: vi.fn<VideoRecorderHost['render']>(async () => new Uint8Array([1, 2, 3])), save: vi.fn<VideoRecorderHost['save']>(async () => ({ filename: 'video.webm', path: '/downloads/video.webm' })), now: () => Date.now() }
  const recorder = new BrowserVideoRecorder(host)
  const capture = vi.fn(async (): Promise<VideoCaptureResult> => ({ data: new Uint8Array([4, 5, 6]), width: 640, height: 360 }))
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
  expect({ ...recorder.state('tab'), timing: undefined }).toEqual({ ...paused, timing: undefined })
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

it('saves an export through the writer its caller chose, and keeps none when the person saved nothing', async () => {
  const { recorder, manage, capture, validate, source, host } = fixture()
  await manage('start')
  await vi.advanceTimersByTimeAsync(1000)
  await manage('stop')
  const saveFile = vi.fn(async (): Promise<string | undefined> => undefined)
  host.save.mockResolvedValueOnce(undefined)
  const output = await recorder.manage('tab', { action: 'export' }, capture, validate, source, undefined, undefined, saveFile)
  expect(host.save).toHaveBeenCalledWith(expect.any(Uint8Array), expect.any(Function), saveFile)
  expect(output).toMatchObject({ status: 'stopped', previewReady: true })
  expect(output.exported).toBeUndefined()
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
  expect(recorder.state('tab')).toMatchObject({ status: 'paused', frameCount: 1, notice: VIDEO_RECORDING_NOTICES.conditions })
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
  expect(recorder.state('tab')).toMatchObject({ status: 'stopped', bytes: VIDEO_LIMITS.bytes, frameCount: 1, notice: VIDEO_RECORDING_NOTICES.sizeLimit })
  await manage('clear'); await manage('start')
  vi.setSystemTime(Date.now() + VIDEO_LIMITS.durationMs)
  await vi.advanceTimersByTimeAsync(100)
  expect(recorder.state('tab').status).toBe('paused')
  expect(recorder.state('tab').durationMs).toBeLessThan(1000)
  await manage('clear'); await manage('start')
  await vi.advanceTimersByTimeAsync(VIDEO_LIMITS.durationMs + 100)
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


it('records three independent targets concurrently and revokes only the affected target', async () => {
  const { recorder, capture, validate } = fixture()
  const a = vi.fn()
  await Promise.all(['one', 'two', 'three'].map(id => recorder.manage(id, { action: 'start' }, capture, id === 'one' ? a : validate, validate)))
  await expect(recorder.manage('four', { action: 'start' }, capture, validate)).rejects.toThrow('maximum three')
  await vi.advanceTimersByTimeAsync(300)
  a.mockImplementation(() => { throw new Error('disconnected') })
  await vi.advanceTimersByTimeAsync(100)
  expect(recorder.state('one').status).toBe('paused')
  expect(recorder.state('two').status).toBe('recording')
  const before = recorder.state('two').frameCount
  recorder.clear('three')
  await vi.advanceTimersByTimeAsync(200)
  expect(recorder.state('two').frameCount).toBeGreaterThan(before)
  expect(recorder.state('three').status).toBe('idle')
  await recorder.manage('one', { action: 'resume' }, capture, validate)
  expect(recorder.state('one').status).toBe('recording')
  recorder.destroy()
})


it('pauses all active captures at the last real frame on suspend without resuming them automatically', async () => {
  const { recorder, capture, validate } = fixture()
  await Promise.all(['one', 'two'].map(id => recorder.manage(id, { action: 'start' }, capture, validate)))
  await vi.advanceTimersByTimeAsync(300)
  recorder.pauseAll('System suspend')
  const states = ['one', 'two'].map(id => recorder.state(id))
  await vi.advanceTimersByTimeAsync(10_000)
  for (const [index, id] of ['one', 'two'].entries()) {
    expect({ ...recorder.state(id), timing: undefined }).toEqual({ ...states[index], timing: undefined })
    expect(recorder.state(id).status).toBe('paused')
  }
  recorder.destroy()
})

it('pauses a sustained unavailable frame stream rather than recording a healthy-looking frozen tail', async () => {
  const { recorder, manage, capture } = fixture()
  await manage('start')
  capture.mockImplementation(async () => null)
  await vi.advanceTimersByTimeAsync(3200)
  expect(recorder.state('tab')).toMatchObject({ status: 'paused', frameCount: 1, notice: VIDEO_RECORDING_NOTICES.gap })
  expect(recorder.state('tab').durationMs).toBeLessThan(100)
  recorder.destroy()
})

it('drops why capture paused by itself once the person stops it, and keeps a limit that stopped it', async () => {
  const { recorder, manage, capture } = fixture()
  await manage('start')
  capture.mockImplementation(async () => null)
  await vi.advanceTimersByTimeAsync(3200)
  expect(recorder.state('tab').notice).toBe(VIDEO_RECORDING_NOTICES.gap)
  await manage('stop')
  expect(recorder.state('tab')).toMatchObject({ status: 'stopped' })
  expect(recorder.state('tab').notice).toBeUndefined()
  await manage('clear')
  capture.mockImplementation(async () => ({ data: new Uint8Array([4, 5, 6]), width: 640, height: 360 }))
  capture.mockResolvedValueOnce({ data: new Uint8Array(VIDEO_LIMITS.bytes), width: 640, height: 360 })
  await manage('start'); await vi.advanceTimersByTimeAsync(100)
  expect(recorder.state('tab').status).toBe('stopped')
  await manage('stop')
  expect(recorder.state('tab').notice).toBe(VIDEO_RECORDING_NOTICES.sizeLimit)
  recorder.destroy()
})

it('keeps 30 samples a second when each capture takes 20 ms', async () => {
  const { recorder, manage, capture } = fixture()
  capture.mockImplementation(() => new Promise(resolve => { setTimeout(() => resolve({ data: new Uint8Array([4]), width: 640, height: 360 }), 20) }))
  const started = manage('start')
  await vi.advanceTimersByTimeAsync(1000)
  await started
  await manage('stop')
  // A delay counted from the end of the last capture would give 1000 / (33 + 20), about 19.
  expect(recorder.state('tab').frameCount).toBeGreaterThanOrEqual(VIDEO_LIMITS.framesPerSecond - 1)
  recorder.destroy()
})

it('records a still page by repeating its last frame without its bytes, and does not pause for a gap', async () => {
  const { recorder, manage, capture } = fixture()
  await manage('start')
  const first = recorder.state('tab')
  capture.mockImplementation(async () => 'unchanged')
  await vi.advanceTimersByTimeAsync(5000)
  const still = recorder.state('tab')
  expect(still.status).toBe('recording')
  expect(still.frameCount).toBeGreaterThanOrEqual(5 * VIDEO_LIMITS.framesPerSecond - 1)
  expect(still.bytes).toBe(first.bytes)
  await manage('stop')
  expect(recorder.state('tab').durationMs).toBe(5000)
  recorder.destroy()
})

it('releases the capture source on pause, stop and clear, and starts it again by capturing after resume', async () => {
  const { recorder, manage, capture } = fixture()
  const release = vi.fn()
  Object.assign(capture, { release })
  await manage('start')
  await manage('pause')
  expect(release).toHaveBeenCalledTimes(1)
  const before = capture.mock.calls.length
  await manage('resume')
  await vi.advanceTimersByTimeAsync(100)
  expect(capture.mock.calls.length).toBeGreaterThan(before)
  await manage('stop')
  expect(release).toHaveBeenCalledTimes(2)
  await manage('clear')
  expect(release).toHaveBeenCalledTimes(3)
  recorder.destroy()
})

it('resumes with the capture of the call that resumes, which checks that call\'s authority, not the one that started', async () => {
  const { recorder, capture, validate, source } = fixture()
  await recorder.manage('tab', { action: 'start' }, capture, validate, source)
  await recorder.manage('tab', { action: 'pause' }, capture, validate, source)
  const resumed = vi.fn(async (): Promise<VideoCaptureResult> => ({ data: new Uint8Array([7]), width: 640, height: 360 }))
  const before = capture.mock.calls.length
  await recorder.manage('tab', { action: 'resume' }, resumed, validate, source)
  await vi.advanceTimersByTimeAsync(200)
  expect(capture.mock.calls.length).toBe(before)
  expect(resumed).toHaveBeenCalled()
  expect(recorder.state('tab')).toMatchObject({ status: 'recording' })
  recorder.destroy()
})

it('repeats nothing before the first frame, so a page that never draws one pauses for a gap', async () => {
  const { recorder, manage, capture } = fixture()
  capture.mockImplementation(async () => 'unchanged')
  await manage('start')
  await vi.advanceTimersByTimeAsync(3200)
  expect(recorder.state('tab')).toMatchObject({ status: 'paused', frameCount: 0, notice: VIDEO_RECORDING_NOTICES.gap })
  recorder.destroy()
})

it('reports a repeat of the last frame as the newest retained frame', async () => {
  const { recorder, manage, capture } = fixture()
  await manage('start')
  capture.mockImplementation(async () => 'unchanged')
  await vi.advanceTimersByTimeAsync(500)
  const state = recorder.state('tab')
  expect(state.frameCount).toBeGreaterThan(1)
  expect(state.timing?.lastFrame).toMatchObject({ sequence: state.frameCount, sourceTimeMs: expect.any(Number) })
  expect(state.timing!.lastFrame!.sourceTimeMs).toBeGreaterThan(400)
  recorder.destroy()
})

it('keeps the recording\'s size across a rounding difference between capture paths, and pauses for a changed viewport', async () => {
  const { recorder, manage, capture } = fixture()
  await manage('start')
  capture.mockImplementation(async () => ({ data: new Uint8Array([8]), width: 640, height: 358 }))
  await vi.advanceTimersByTimeAsync(100)
  expect(recorder.state('tab')).toMatchObject({ status: 'recording', width: 640, height: 360 })
  expect(recorder.state('tab').frameCount).toBeGreaterThan(1)
  capture.mockImplementation(async () => ({ data: new Uint8Array([9]), width: 600, height: 338 }))
  await vi.advanceTimersByTimeAsync(100)
  expect(recorder.state('tab')).toMatchObject({ status: 'paused', width: 640, height: 360, notice: VIDEO_RECORDING_NOTICES.conditions })
  recorder.destroy()
})

it('changes nothing when asked again for the pause or stop it already has', async () => {
  const { recorder, manage, host } = fixture()
  await manage('start')
  await vi.advanceTimersByTimeAsync(200)
  await manage('pause')
  const paused = recorder.state('tab').timing!.revision
  await manage('pause')
  expect(recorder.state('tab').timing!.revision).toBe(paused)
  await manage('stop')
  await manage('render')
  const stopped = recorder.state('tab')
  expect(stopped.timing!.revision).toBeGreaterThan(paused)
  await manage('stop')
  expect(recorder.state('tab').timing!.revision).toBe(stopped.timing!.revision)
  expect(recorder.state('tab').previewReady).toBe(true)
  expect(host.render).toHaveBeenCalledTimes(1)
  recorder.destroy()
})
