import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { BrowserVideoRecorder } from '../src/main/browser/video-recorder.js'
import { videoSourceTime, type BrowserVideoOptions } from '../src/shared/video.js'

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(10_000) })
afterEach(() => vi.useRealTimers())
const frame = { data: new Uint8Array([1]), width: 2, height: 2 }
function fixture() {
  const recorder = new BrowserVideoRecorder({ now: () => Date.now(), changed() {}, render: async () => new Uint8Array([1]), save: async () => ({ filename: 'test.webm', path: '/test.webm' }) })
  const capture = vi.fn<() => Promise<typeof frame | null>>(async () => frame)
  const call = (action: BrowserVideoOptions['action'], extra: Partial<BrowserVideoOptions> = {}) => recorder.manage('tab', { action, ...extra }, capture, () => {})
  return { recorder, capture, call }
}

it('distinguishes response observation, source time and uncertain asynchronous capture bounds', async () => {
  const { recorder, capture, call } = fixture()
  let finish!: (value: typeof frame) => void
  capture.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  const pending = call('start')
  expect(recorder.state('tab').timing?.lastFrame).toBeUndefined()
  vi.setSystemTime(10_400); finish(frame)
  const started = await pending
  expect(started.timing).toEqual({ clock: 'recording-monotonic', observedAtMs: 400, sourceTimeMs: 400, revision: 0, pixelTime: 'unknown', lastFrame: { sequence: 1, sourceTimeMs: 0, captureStartedAtMs: 0, captureCompletedAtMs: 400, revision: 0 } })
  vi.setSystemTime(10_650)
  const received = await call('get')
  expect(received.timing).toMatchObject({ observedAtMs: 650, sourceTimeMs: 650, lastFrame: started.timing!.lastFrame })
  expect(started.timing!.observedAtMs).toBe(400)
  expect(received.durationMs).toBe(received.timing!.sourceTimeMs)
  recorder.destroy()
})

it('freezes source time during pause while observation time advances, and revises on resume and stop', async () => {
  const { recorder, call } = fixture()
  await call('start'); vi.setSystemTime(10_400)
  const paused = await call('pause'); vi.setSystemTime(10_900)
  expect((await call('get')).timing).toMatchObject({ observedAtMs: 900, sourceTimeMs: 400, revision: 1, lastFrame: { revision: 0 } })
  expect(paused.timing?.sourceTimeMs).toBe(400)
  expect((await call('resume')).timing?.revision).toBe(2)
  vi.setSystemTime(11_100)
  expect((await call('stop')).timing).toMatchObject({ observedAtMs: 1100, sourceTimeMs: 600, revision: 3 })
  recorder.destroy()
})

it('invalidates a duration observation when interruption recovery removes the unsampled tail', async () => {
  const { recorder, call } = fixture()
  await call('start'); vi.setSystemTime(11_000)
  const before = await call('get'); recorder.pauseAll('Interrupted')
  const after = await call('get')
  expect(before.timing).toMatchObject({ sourceTimeMs: 1000, revision: 0 })
  expect(after.timing).toMatchObject({ sourceTimeMs: 83, revision: 1, lastFrame: { sourceTimeMs: 0, revision: 0 } })
  recorder.destroy()
})

it('does not invent retained-frame observations for dropped captures or accept late frames across pause/resume', async () => {
  const { recorder, capture, call } = fixture()
  const start = await call('start')
  capture.mockResolvedValueOnce(null)
  await vi.advanceTimersByTimeAsync(90)
  expect((await call('get')).timing?.lastFrame).toEqual(start.timing?.lastFrame)
  let finish!: (value: typeof frame) => void
  capture.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  await vi.advanceTimersByTimeAsync(90)
  await call('pause'); await call('resume'); finish(frame)
  await vi.advanceTimersByTimeAsync(1)
  const resumed = await call('get')
  expect(resumed.frameCount).toBe(1)
  expect(resumed.timing).toMatchObject({ revision: 2, lastFrame: start.timing!.lastFrame })
  recorder.destroy()
})

it('keeps source observations separate from trimmed output and revises derived edit mappings', async () => {
  const { recorder, call } = fixture()
  const start = await call('start'); vi.setSystemTime(11_000); const stopped = await call('stop')
  const edited = await call('edit', { clips: [{ startMs: 200, endMs: 500 }, { startMs: 700, endMs: 900 }] })
  expect(edited.timing).toMatchObject({ sourceTimeMs: 1000, revision: stopped.timing!.revision + 1, lastFrame: start.timing!.lastFrame })
  expect(videoSourceTime(edited.clips, 350)).toBe(750)
  const exported = await call('export')
  expect(exported.exported?.durationMs).toBe(500)
  expect(exported.timing?.sourceTimeMs).toBe(1000)
  recorder.destroy()
})

it('uses new identity and clock on clear/start and returns detached metadata without frame bytes', async () => {
  const { recorder, call } = fixture()
  const first = await call('start')
  first.timing!.lastFrame!.sourceTimeMs = 999
  expect((await call('get')).timing?.lastFrame?.sourceTimeMs).toBe(0)
  expect(JSON.stringify(first.timing)).not.toContain('data')
  const cleared = await call('clear'); expect(cleared.timing).toBeUndefined()
  vi.setSystemTime(12_000); const second = await call('start')
  expect(second.recordingId).not.toBe(first.recordingId)
  expect(second.timing).toMatchObject({ observedAtMs: 0, revision: 0 })
  recorder.destroy(); expect(recorder.state('tab').timing).toBeUndefined()
})
