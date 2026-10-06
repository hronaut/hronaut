import { VIDEO_INSPECTION_LIMITS, videoInspectionSchema, type BrowserVideoInspectionOptions, type VideoInspectionReport } from '../../shared/video-inspection.js'
import { selectVideoFrames, type SelectedVideoFrame } from './video-inspection-frames.js'
import { randomUUID } from 'node:crypto'
import { VIDEO_LIMITS, videoOptionsSchema, validateVideoEdit, type BrowserVideoOptions, type BrowserVideoState, type VideoFrame, type VideoRenderPlan, type VideoTimingObservation } from '../../shared/video.js'
import { VIDEO_AUDIO_BUILTINS, VIDEO_AUDIO_LIMITS, normalizeVideoAudioWav } from '../../shared/video-audio.js'

export interface VideoSourceBinding { readonly tabId: string; readonly workspaceId: string | undefined; readonly origin: string }
export interface PendingVideoInspection {
  readonly report: VideoInspectionReport
  image?: Uint8Array
  assertCurrent(): void
  discard(): void
}

interface CapturedFrame { data: Uint8Array; width: number; height: number }
interface Recording {
  state: BrowserVideoState
  frames: VideoFrame[]
  source?: Readonly<VideoSourceBinding>
  elapsedMs: number
  clockOrigin: number
  lastFrameTiming?: VideoTimingObservation['lastFrame']
  runningSince: number
  lastFrameAt: number
  timer?: ReturnType<typeof setTimeout>
  pending?: Promise<void>
  validate: () => void
  validateSource: () => void
  captureRevision: number
  capture: () => Promise<CapturedFrame | null>
  preview?: Uint8Array
  abort: AbortController
  busy: boolean
  audioAssets: Map<string, Uint8Array>
}
export interface VideoRecorderHost {
  inspect?(frames: readonly SelectedVideoFrame[], signal: AbortSignal, validate: () => void): Promise<Uint8Array>
  changed(): void
  render(plan: VideoRenderPlan, frames: readonly VideoFrame[], signal: AbortSignal, validate: () => void, assets?: readonly { id: string; data: Uint8Array }[]): Promise<Uint8Array>
  save(data: Uint8Array, validate: () => void): Promise<{ filename: string; path: string }>
  loadAudio?(path: string, validate: () => void): Promise<Uint8Array>
  now?: () => number
}

/** Raw pixels are opt-in, bounded and memory-only. Each recording belongs to exactly one live tab. */
export class BrowserVideoRecorder {
  private readonly recordings = new Map<string, Recording>()
  private readonly now: () => number
  constructor(private readonly host: VideoRecorderHost) { this.now = host.now ?? (() => performance.now()) }

  state(tabId: string): BrowserVideoState {
    const r = this.recordings.get(tabId)
    const state = r?.state ?? { tabId, status: 'idle', durationMs: 0, width: 0, height: 0, frameCount: 0, bytes: 0, annotations: [], clips: [], audio: [], cameras: [], audioAssets: [...VIDEO_AUDIO_BUILTINS], previewReady: false }
    const now = this.now()
    const sourceTimeMs = r ? this.duration(r, now) : 0
    return structuredClone({ ...state, ...(r ? {
      durationMs: sourceTimeMs,
      timing: {
        clock: 'recording-monotonic' as const,
        observedAtMs: Math.round(now - r.clockOrigin),
        sourceTimeMs,
        revision: r.captureRevision,
        pixelTime: 'unknown' as const,
        ...(r.lastFrameTiming ? { lastFrame: r.lastFrameTiming } : {})
      }
    } : {}) })
  }

  preview(tabId: string): Uint8Array {
    const recording = this.recordings.get(tabId)
    recording?.validateSource()
    const data = recording?.preview
    if (!data) throw new Error('Render a preview first')
    return data
  }

  async inspect(tabId: string, input: BrowserVideoInspectionOptions, authorize: (source: VideoSourceBinding) => void, signal?: AbortSignal): Promise<PendingVideoInspection> {
    const options = videoInspectionSchema.parse(input)
    const recording = this.recordings.get(tabId)
    if (!recording?.source || !recording.frames.length) throw new Error('Inspect a non-empty retained recording')
    const assertCurrent = (): void => {
      if (signal?.aborted || recording.abort.signal.aborted || this.recordings.get(tabId) !== recording
        || recording.state.recordingId !== options.recordingId || recording.captureRevision !== options.expectedRevision
        || recording.state.status !== 'stopped') throw new Error('Video inspection was cancelled or its recording identity/revision changed')
      recording.validateSource()
      authorize(recording.source!)
    }
    assertCurrent()
    if (options.endMs > recording.elapsedMs) throw new Error('Inspection interval exceeds recording duration')
    const selected = selectVideoFrames(recording.frames, options.startMs, options.endMs, options.maxFrames)
    const report: VideoInspectionReport = {
      recordingId: options.recordingId, revision: options.expectedRevision,
      status: selected.frames.length ? 'sheet' : 'empty',
      interval: { startMs: options.startMs, endMs: options.endMs, inclusive: true },
      retainedFrames: selected.retained, selectedFrames: selected.frames.length, omittedFrames: selected.retained - selected.frames.length,
      sampling: 'retained-index-uniform', clock: 'recording-source', pixelTime: 'unknown',
      frames: selected.frames.map((frame, index) => ({ label: index + 1, sequence: frame.sequence, sourceTimeMs: frame.sourceTimeMs })),
      ...(selected.frames.length ? { image: { width: Math.min(selected.frames.length, VIDEO_INSPECTION_LIMITS.columns) * VIDEO_INSPECTION_LIMITS.tileWidth,
        height: Math.ceil(selected.frames.length / VIDEO_INSPECTION_LIMITS.columns) * (VIDEO_INSPECTION_LIMITS.tileHeight + VIDEO_INSPECTION_LIMITS.labelHeight), mimeType: 'image/png' as const } } : {}),
      notice: 'Only sampled retained source frames are shown. Omitted or uncaptured frames and capture gaps cannot establish that an event was absent. Source timestamps are not exact pixel times.'
    }
    let image: Uint8Array | undefined
    if (selected.frames.length) {
      if (!this.host.inspect) throw new Error('Video inspection is unavailable')
      image = await this.host.inspect(selected.frames, signal ? AbortSignal.any([signal, recording.abort.signal]) : recording.abort.signal, assertCurrent)
    }
    assertCurrent()
    const pending: PendingVideoInspection = { report, image, assertCurrent, discard: () => { pending.image = undefined } }
    return pending
  }

  private duration(r: Recording, now = this.now()): number {
    return Math.min(VIDEO_LIMITS.durationMs, Math.round(r.elapsedMs + (r.state.status === 'recording' ? now - r.runningSince : 0)))
  }

  async manage(tabId: string, input: BrowserVideoOptions, capture: () => Promise<CapturedFrame | null>, validate: () => void, validateSource: () => void = validate, signal?: AbortSignal, source?: VideoSourceBinding): Promise<BrowserVideoState> {
    const options = videoOptionsSchema.parse(input)
    if (options.action === 'inspect') throw new Error('Use the video inspection operation')
    if (['recordingId', 'expectedRevision', 'startMs', 'endMs', 'maxFrames'].some(key => input[key as keyof BrowserVideoOptions] !== undefined)) throw new Error('Inspection arguments require inspect')
    if (options.action === 'get') { this.recordings.get(tabId)?.validateSource(); return this.state(tabId) }
    if (options.action === 'clear') { this.clear(tabId); return this.state(tabId) }
    let r = this.recordings.get(tabId)
    if (r?.busy) throw new Error('Wait for the current video operation to finish')
    if (options.action === 'start') {
      if (r) throw new Error('Clear the previous recording before starting another')
      if (this.recordings.size >= VIDEO_LIMITS.recordings) throw new Error('Clear a retained recording first (maximum three)')
      validate()
      const now = this.now()
      r = { state: { ...this.state(tabId), recordingId: randomUUID(), status: 'recording' }, frames: [], source: source ? Object.freeze({ ...source }) : undefined, audioAssets: new Map(), elapsedMs: 0, clockOrigin: now, runningSince: now, lastFrameAt: now, capture, validate, validateSource, captureRevision: 0, abort: new AbortController(), busy: true }
      this.recordings.set(tabId, r)
      this.host.changed()
      await this.sample(tabId, r)
      r.busy = false
      this.schedule(tabId, r)
      return this.state(tabId)
    }
    if (!r) throw new Error('Start a recording first')
    validate()
    const recording = r
    const current = (): void => {
      if (this.recordings.get(tabId) !== recording || recording.abort.signal.aborted || signal?.aborted) throw new Error('Video operation was cancelled')
      recording.validateSource()
      validate()
    }
    if (options.action === 'pause' || options.action === 'stop') {
      if (options.action === 'pause' && r.state.status === 'stopped') throw new Error('Stopped recordings cannot resume; start a new recording after clearing')
      this.halt(r, options.action === 'pause' ? 'paused' : 'stopped')
    } else if (options.action === 'resume') {
      if (r.state.status !== 'paused') throw new Error('Only a paused recording can resume')
      if (r.elapsedMs >= VIDEO_LIMITS.durationMs || r.state.bytes >= VIDEO_LIMITS.bytes) throw new Error('Recording limit reached')
      validate()
      r.validateSource()
      r.validate = validate
      r.captureRevision += 1
      r.runningSince = this.now()
      r.lastFrameAt = this.now()
      r.state.status = 'recording'
      r.state.notice = undefined
      this.schedule(tabId, r)
    } else if (options.action === 'import-audio') {
      current()
      if (r.state.status !== 'stopped') throw new Error('Stop recording before importing audio')
      if (!options.audioPath || !options.audioProvenance) throw new Error('Audio import requires an absolute path and source/usage rights')
      if (!this.host.loadAudio) throw new Error('Audio import is unavailable')
      if (r.audioAssets.size >= VIDEO_AUDIO_LIMITS.assets) throw new Error('Remove an imported audio asset first (maximum eight)')
      r.busy = true
      try {
        const bytes = await this.host.loadAudio(options.audioPath, current)
        current()
        const asset = normalizeVideoAudioWav(bytes)
        if (asset.data.byteLength + [...r.audioAssets.values()].reduce((sum, data) => sum + data.byteLength, 0) > VIDEO_AUDIO_LIMITS.totalBytes) throw new Error('Imported audio exceeds the 32 MiB recording limit')
        current()
        const id = randomUUID()
        r.audioAssets.set(id, asset.data)
        r.state.audioAssets = [...(r.state.audioAssets ?? []), { id, name: options.audioName ?? `Imported audio ${r.audioAssets.size}`, durationMs: asset.durationMs, provenance: options.audioProvenance, builtin: false }]
      } finally { r.busy = false; this.host.changed() }
    } else if (options.action === 'remove-audio') {
      current()
      if (r.state.status !== 'stopped') throw new Error('Stop recording before removing audio')
      if (!options.assetId || !r.audioAssets.has(options.assetId)) throw new Error('Imported audio asset is unavailable')
      if (r.state.audio?.some(event => event.assetId === options.assetId)) throw new Error('Remove this asset from the audio timeline first')
      r.audioAssets.delete(options.assetId)
      r.state.audioAssets = r.state.audioAssets?.filter(asset => asset.id !== options.assetId)
    } else if (options.action === 'edit') {
      r.validateSource()
      if (r.state.status !== 'stopped') throw new Error('Stop recording before editing')
      const annotations = options.annotations ?? r.state.annotations
      const clips = options.clips ?? r.state.clips
      validateVideoEdit(this.duration(r), annotations, clips)
      const audio = options.audio ?? r.state.audio ?? []
      const cameras = options.cameras ?? r.state.cameras ?? []
      const duration = clips.length ? clips.reduce((sum, clip) => sum + clip.endMs - clip.startMs, 0) : this.duration(r)
      for (const event of audio) {
        const asset = r.state.audioAssets?.find(asset => asset.id === event.assetId)
        if (!asset) throw new Error('Audio asset is unavailable in this recording')
        if (event.endMs > duration) throw new Error('Audio events must fit inside the finished video')
        if (event.offsetMs >= asset.durationMs || (!event.loop && event.offsetMs + event.endMs - event.startMs > asset.durationMs + 0.01)) throw new Error('Audio event exceeds its asset; shorten it or enable looping')
      }
      let previousEnd = 0
      for (const camera of cameras) {
        if (camera.startMs < previousEnd || camera.endMs > this.duration(r)) throw new Error('Camera moves must be ordered, non-overlapping and inside the recording')
        previousEnd = camera.endMs
      }
      current()
      r.captureRevision += 1
      r.state.annotations = annotations
      r.state.clips = clips
      r.state.audio = audio
      r.state.cameras = cameras
      r.state.transition = options.transition ?? r.state.transition
      r.preview = undefined
      r.state.previewReady = false
      r.state.exported = undefined
    } else if (options.action === 'render' || options.action === 'export') {
      if (r.state.status !== 'stopped' || !r.frames.length || !r.elapsedMs) throw new Error('Stop a non-empty recording before exporting')
      r.busy = true
      r.state.status = 'rendering'
      this.host.changed()
      try {
        current()
        const clips = r.state.clips.length ? r.state.clips : [{ startMs: 0, endMs: r.elapsedMs }]
        if (!r.preview) {
          const preview = await this.host.render({ width: r.state.width, height: r.state.height, annotations: r.state.annotations, audio: r.state.audio, cameras: r.state.cameras, transition: r.state.transition, durationMs: r.elapsedMs, clips }, r.frames, signal ? AbortSignal.any([r.abort.signal, signal]) : r.abort.signal, current, [...r.audioAssets].filter(([id]) => r.state.audio?.some(event => event.assetId === id)).map(([id, data]) => ({ id, data })))
          current()
          r.preview = preview
        }
        current()
        r.state.previewReady = true
        if (options.action === 'export') {
          const saved = await this.host.save(r.preview, current)
          current()
          r.state.exported = { ...saved, bytes: r.preview.byteLength, mimeType: 'video/webm', codec: 'vp9', ...(r.state.audio?.length ? { audioCodec: 'opus' as const } : {}), durationMs: clips.reduce((sum, clip) => sum + clip.endMs - clip.startMs, 0) }
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
    const startedAt = this.now()
    const timeMs = this.duration(r, startedAt)
    try {
      r.validateSource()
      r.validate()
      if (this.now() - r.lastFrameAt > 3000) { this.pauseAtLastFrame(r, 'Capture paused after a gap without frames; resume explicitly'); return }
      if (timeMs >= VIDEO_LIMITS.durationMs) { this.halt(r, 'stopped', 'Recording reached its two-minute limit'); return }
      const frame = await Promise.race([r.capture(), new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error('Capture timeout')), 3000) })])
      const completedAt = this.now()
      if (this.recordings.get(tabId) !== r || r.state.status !== 'recording' || revision !== r.captureRevision) return
      r.validateSource()
      r.validate()
      if (!frame) return
      if (r.state.bytes + frame.data.byteLength > VIDEO_LIMITS.bytes) { this.halt(r, 'stopped', 'Recording reached its 64 MiB limit'); return }
      if (!frame.data.byteLength || !frame.width || !frame.height) throw new Error('Empty frame')
      if (r.frames.length && (frame.width !== r.state.width || frame.height !== r.state.height)) throw new Error('Viewport changed')
      r.lastFrameAt = this.now()
      r.frames.push(Object.freeze({ timeMs: r.frames.length ? timeMs : 0, data: Uint8Array.from(frame.data) }))
      r.lastFrameTiming = {
        sequence: r.frames.length,
        sourceTimeMs: r.frames.at(-1)!.timeMs,
        captureStartedAtMs: Math.round(startedAt - r.clockOrigin),
        captureCompletedAtMs: Math.round(completedAt - r.clockOrigin),
        revision
      }
      Object.assign(r.state, { width: frame.width, height: frame.height, frameCount: r.frames.length, bytes: r.state.bytes + frame.data.byteLength })
      if (r.frames.length % VIDEO_LIMITS.framesPerSecond === 0) this.host.changed()
    } catch {
      if (this.recordings.get(tabId) === r && r.state.status === 'recording' && revision === r.captureRevision) this.pauseAtLastFrame(r, 'Capture paused: keep Hronaut visible and the source tab awake, at its original origin and size, with recording access available')
    } finally { if (timeout) clearTimeout(timeout) }
  }

  private pauseAtLastFrame(r: Recording, notice: string): void {
    // No multi-second stale-frame tail when capture stalls or the machine sleeps.
    r.elapsedMs = Math.min(this.duration(r), (r.frames.at(-1)?.timeMs ?? 0) + 1000 / VIDEO_LIMITS.framesPerSecond)
    r.runningSince = this.now()
    this.halt(r, 'paused', notice)
  }

  pauseAll(notice: string): void {
    for (const r of this.recordings.values()) {
      if (r.state.status === 'recording') this.pauseAtLastFrame(r, notice)
    }
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
    r.audioAssets.clear()
    r.preview = undefined
    this.host.changed()
  }

  destroy(): void { for (const id of this.recordings.keys()) this.clear(id) }
}
