import { randomUUID } from 'node:crypto'
import { VIDEO_LIMITS, videoOptionsSchema, validateVideoEdit, type BrowserVideoOptions, type BrowserVideoState, type VideoFrame, type VideoRenderPlan } from '../../shared/video.js'

interface CapturedFrame { data: Uint8Array; width: number; height: number }
interface Recording {
  state: BrowserVideoState
  frames: VideoFrame[]
  elapsedMs: number
  runningSince: number
  timer?: ReturnType<typeof setTimeout>
  pending?: Promise<void>
  validate: () => void
  validateSource: () => void
  captureRevision: number
  capture: () => Promise<CapturedFrame | null>
  preview?: Uint8Array
  abort: AbortController
  busy: boolean
}
export interface VideoRecorderHost {
  changed(): void
  render(plan: VideoRenderPlan, frames: readonly VideoFrame[], signal: AbortSignal, validate: () => void): Promise<Uint8Array>
  save(data: Uint8Array, validate: () => void): Promise<{ filename: string; path: string }>
  now?: () => number
}

/** Raw pixels are opt-in, bounded and memory-only. Each recording belongs to exactly one live tab. */
export class BrowserVideoRecorder {
  private readonly recordings = new Map<string, Recording>()
  private readonly now: () => number
  constructor(private readonly host: VideoRecorderHost) { this.now = host.now ?? (() => performance.now()) }

  state(tabId: string): BrowserVideoState {
    const r = this.recordings.get(tabId)
    const state = r?.state ?? { tabId, status: 'idle', durationMs: 0, width: 0, height: 0, frameCount: 0, bytes: 0, annotations: [], clips: [], previewReady: false }
    return structuredClone({ ...state, ...(r ? { durationMs: this.duration(r) } : {}) })
  }

  preview(tabId: string): Uint8Array {
    const recording = this.recordings.get(tabId)
    recording?.validateSource()
    const data = recording?.preview
    if (!data) throw new Error('Render a preview first')
    return data
  }

  private duration(r: Recording): number {
    return Math.min(VIDEO_LIMITS.durationMs, Math.round(r.elapsedMs + (r.state.status === 'recording' ? this.now() - r.runningSince : 0)))
  }

  async manage(tabId: string, input: BrowserVideoOptions, capture: () => Promise<CapturedFrame | null>, validate: () => void, validateSource: () => void = validate): Promise<BrowserVideoState> {
    const options = videoOptionsSchema.parse(input)
    if (options.action === 'get') { this.recordings.get(tabId)?.validateSource(); return this.state(tabId) }
    if (options.action === 'clear') { this.clear(tabId); return this.state(tabId) }
    let r = this.recordings.get(tabId)
    if (r?.busy) throw new Error('Wait for the current video operation to finish')
    if (options.action === 'start') {
      if (r) throw new Error('Clear the previous recording before starting another')
      if (this.recordings.size >= VIDEO_LIMITS.recordings) throw new Error('Clear a retained recording first (maximum three)')
      if ([...this.recordings.values()].some(item => item.state.status === 'recording')) throw new Error('Pause or stop the current recording first')
      validate()
      r = { state: { ...this.state(tabId), recordingId: randomUUID(), status: 'recording' }, frames: [], elapsedMs: 0, runningSince: this.now(), capture, validate, validateSource, captureRevision: 0, abort: new AbortController(), busy: true }
      this.recordings.set(tabId, r)
      this.host.changed()
      await this.sample(tabId, r)
      r.busy = false
      this.schedule(tabId, r)
      return this.state(tabId)
    }
    if (!r) throw new Error('Start a recording first')
    if (options.action === 'pause' || options.action === 'stop') {
      if (options.action === 'pause' && r.state.status === 'stopped') throw new Error('Stopped recordings cannot resume; start a new recording after clearing')
      this.halt(r, options.action === 'pause' ? 'paused' : 'stopped')
    } else if (options.action === 'resume') {
      if (r.state.status !== 'paused') throw new Error('Only a paused recording can resume')
      if (r.elapsedMs >= VIDEO_LIMITS.durationMs || r.state.bytes >= VIDEO_LIMITS.bytes) throw new Error('Recording limit reached')
      if ([...this.recordings.values()].some(item => item.state.status === 'recording')) throw new Error('Pause or stop the current recording first')
      validate()
      r.validateSource()
      r.validate = validate
      r.runningSince = this.now()
      r.state.status = 'recording'
      r.state.notice = undefined
      this.schedule(tabId, r)
    } else if (options.action === 'edit') {
      r.validateSource()
      if (r.state.status !== 'stopped') throw new Error('Stop recording before editing')
      const annotations = options.annotations ?? r.state.annotations
      const clips = options.clips ?? r.state.clips
      validateVideoEdit(this.duration(r), annotations, clips)
      r.state.annotations = annotations
      r.state.clips = clips
      r.preview = undefined
      r.state.previewReady = false
      r.state.exported = undefined
    } else if (options.action === 'render' || options.action === 'export') {
      if (r.state.status !== 'stopped' || !r.frames.length || !r.elapsedMs) throw new Error('Stop a non-empty recording before exporting')
      r.busy = true
      r.state.status = 'rendering'
      this.host.changed()
      const recording = r
      const current = (): void => {
        if (this.recordings.get(tabId) !== recording || recording.abort.signal.aborted) throw new Error('Video operation was cancelled')
        recording.validateSource()
        validate()
      }
      try {
        current()
        const clips = r.state.clips.length ? r.state.clips : [{ startMs: 0, endMs: r.elapsedMs }]
        if (!r.preview) r.preview = await this.host.render({ ...r.state, durationMs: r.elapsedMs, clips }, r.frames, r.abort.signal, current)
        current()
        r.state.previewReady = true
        if (options.action === 'export') {
          const saved = await this.host.save(r.preview, current)
          current()
          r.state.exported = { ...saved, bytes: r.preview.byteLength, mimeType: 'video/webm', codec: 'vp9', durationMs: clips.reduce((sum, clip) => sum + clip.endMs - clip.startMs, 0) }
        }
      } finally {
        r.busy = false
        r.state.status = 'stopped'
        this.host.changed()
      }
    }
    this.host.changed()
    return this.state(tabId)
  }

  private schedule(tabId: string, r: Recording): void {
    if (r.state.status !== 'recording' || this.recordings.get(tabId) !== r || r.timer || r.pending) return
    r.timer = setTimeout(() => {
      r.timer = undefined
      r.pending = this.sample(tabId, r).finally(() => { r.pending = undefined; this.schedule(tabId, r) })
    }, 1000 / VIDEO_LIMITS.framesPerSecond)
    r.timer.unref?.()
  }

  private async sample(tabId: string, r: Recording): Promise<void> {
    let timeout: ReturnType<typeof setTimeout> | undefined
    const revision = r.captureRevision
    const timeMs = this.duration(r)
    try {
      r.validateSource()
      r.validate()
      if (timeMs >= VIDEO_LIMITS.durationMs) { this.halt(r, 'stopped', 'Recording reached its two-minute limit'); return }
      const frame = await Promise.race([r.capture(), new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error('Capture timeout')), 3000) })])
      if (this.recordings.get(tabId) !== r || r.state.status !== 'recording' || revision !== r.captureRevision) return
      r.validateSource()
      r.validate()
      if (!frame) return
      if (r.state.bytes + frame.data.byteLength > VIDEO_LIMITS.bytes) { this.halt(r, 'stopped', 'Recording reached its 64 MiB limit'); return }
      if (!frame.data.byteLength || !frame.width || !frame.height) throw new Error('Empty frame')
      if (r.frames.length && (frame.width !== r.state.width || frame.height !== r.state.height)) throw new Error('Viewport changed')
      r.frames.push({ timeMs: r.frames.length ? timeMs : 0, data: frame.data })
      Object.assign(r.state, { width: frame.width, height: frame.height, frameCount: r.frames.length, bytes: r.state.bytes + frame.data.byteLength })
      if (r.frames.length % VIDEO_LIMITS.framesPerSecond === 0) this.host.changed()
    } catch {
      if (this.recordings.get(tabId) === r && r.state.status === 'recording' && revision === r.captureRevision) this.halt(r, 'paused', 'Capture paused: keep this tab visible, at the original origin and size, with recording access available')
    } finally { if (timeout) clearTimeout(timeout) }
  }

  private halt(r: Recording, status: 'paused' | 'stopped', notice?: string): void {
    r.captureRevision += 1
    r.elapsedMs = this.duration(r)
    r.state.durationMs = r.elapsedMs
    r.state.status = status
    if (notice) r.state.notice = notice
    if (r.timer) clearTimeout(r.timer)
    r.timer = undefined
    this.host.changed()
  }

  clear(tabId: string): void {
    const r = this.recordings.get(tabId)
    if (!r) return
    this.recordings.delete(tabId)
    if (r.timer) clearTimeout(r.timer)
    r.abort.abort()
    r.frames.length = 0
    r.preview = undefined
    this.host.changed()
  }

  destroy(): void { for (const id of this.recordings.keys()) this.clear(id) }
}
