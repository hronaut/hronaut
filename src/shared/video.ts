import { z } from 'zod'
import { videoInspectionFields } from './video-inspection.js'

export const VIDEO_LIMITS = { durationMs: 120_000, framesPerSecond: 12, width: 1280, height: 720, bytes: 64 * 1024 * 1024, recordings: 3, annotations: 100, clips: 30 } as const
const time = z.number().finite().min(0).max(VIDEO_LIMITS.durationMs)
const point = z.number().finite().min(0).max(1)
export const VIDEO_ANNOTATION_KINDS = ['text', 'callout', 'arrow', 'highlight', 'spotlight', 'click'] as const
export const VIDEO_TEXT_PRESETS = ['caption', 'title', 'label'] as const
export const VIDEO_PLACEMENTS = ['auto', 'custom', 'top-left', 'top-center', 'top-right', 'center-left', 'center-right', 'bottom-left', 'bottom-center', 'bottom-right'] as const
const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/)
export const videoAnnotationSchema = z.object({
  kind: z.enum(VIDEO_ANNOTATION_KINDS),
  startMs: time,
  endMs: time,
  x: point.optional().describe('Normalized left position. Omit for automatic text/callout placement.'),
  y: point.optional().describe('Normalized top position. Omit for automatic text/callout placement.'),
  endX: point.optional(),
  endY: point.optional(),
  text: z.string().trim().min(1).max(240).optional(),
  color: hex.default('#7c3aed').describe('Accent color for borders, pointers and step badges. Text uses a contrasting neutral color.'),
  textColor: hex.optional(),
  preset: z.enum(VIDEO_TEXT_PRESETS).optional().describe('Text treatment: caption, larger title, or compact label.'),
  placement: z.enum(VIDEO_PLACEMENTS).optional().describe('Safe-margin text/card anchor. Auto places a callout opposite its target; custom uses x/y.'),
  width: z.number().finite().min(0.15).max(0.9).optional().describe('Maximum card width as a fraction of the video; text wraps at words.'),
  size: z.enum(['small', 'medium', 'large']).optional(),
  theme: z.enum(['dark', 'light']).optional(),
  align: z.enum(['left', 'center', 'right']).optional().describe('Alignment of lines inside the card, independently of the card placement.'),
  title: z.string().trim().min(1).max(80).optional().describe('Optional heading above callout text.'),
  step: z.number().int().min(1).max(99).optional().describe('Optional numbered step badge on a callout.'),
  animation: z.enum(['none', 'fade', 'draw']).optional().describe('Default fade uses short entrances/exits; draw also reveals arrows and pulses click markers.'),
  curvature: z.number().finite().min(-1).max(1).optional().describe('Arrow bend; zero makes a straight arrow.')
}).strict().refine(a => a.endMs > a.startMs, 'Annotation end must follow its start')
  .refine(a => !['text', 'callout'].includes(a.kind) || !!a.text, 'Text and callout annotations require text')
  .refine(a => !['arrow', 'highlight', 'spotlight', 'click'].includes(a.kind) || (a.x !== undefined && a.y !== undefined), 'This annotation requires x/y coordinates')
  .refine(a => !['arrow', 'highlight', 'spotlight', 'callout'].includes(a.kind) || (a.endX !== undefined && a.endY !== undefined), 'Arrows, regions and callouts require an end point')
  .refine(a => !['highlight', 'spotlight'].includes(a.kind) || (a.x !== a.endX && a.y !== a.endY), 'Regions must have a non-zero width and height')
  .refine(a => a.placement !== 'custom' || (a.x !== undefined && a.y !== undefined), 'Custom placement requires x/y coordinates')
export const videoClipSchema = z.object({ startMs: time, endMs: time }).strict()
  .refine(c => c.endMs > c.startMs, 'Clip end must follow its start')
export const videoAudioEventSchema = z.object({
  assetId: z.string().min(1).max(80), startMs: time, endMs: time,
  offsetMs: time.default(0), volume: point.default(0.5),
  fadeInMs: time.default(0), fadeOutMs: time.default(0), loop: z.boolean().default(false)
}).strict().refine(a => a.endMs > a.startMs, 'Audio end must follow its start')
  .refine(a => a.fadeInMs + a.fadeOutMs <= a.endMs - a.startMs, 'Audio fades must fit inside the event')
export const videoCameraSchema = z.object({
  startMs: time, endMs: time, x: point, y: point,
  zoom: z.number().finite().min(1).max(3).default(1.5),
  endX: point.optional(), endY: point.optional(), endZoom: z.number().finite().min(1).max(3).optional(),
  easeMs: z.number().finite().min(0).max(2000).default(300)
}).strict().refine(c => c.endMs > c.startMs, 'Camera end must follow its start')
export const videoTransitionSchema = z.object({ durationMs: z.number().finite().min(0).max(1000).default(300) }).strict()
export const videoOptionsShape = {
  tabId: z.string().min(1).max(128).optional(),
  action: z.enum(['get', 'start', 'pause', 'resume', 'stop', 'edit', 'render', 'export', 'clear', 'import-audio', 'remove-audio', 'inspect']).default('get'),
  recordingId: videoInspectionFields.recordingId.optional(),
  expectedRevision: videoInspectionFields.expectedRevision.optional(),
  startMs: videoInspectionFields.startMs.optional(),
  endMs: videoInspectionFields.endMs.optional(),
  maxFrames: videoInspectionFields.maxFrames.optional(),
  annotations: z.array(videoAnnotationSchema).max(VIDEO_LIMITS.annotations).optional(),
  clips: z.array(videoClipSchema).min(1).max(VIDEO_LIMITS.clips).optional(),
  audio: z.array(videoAudioEventSchema).max(32).optional().describe('Replaces audio events on the finished output timeline, in milliseconds. Built-in and imported asset IDs come from get.'),
  cameras: z.array(videoCameraSchema).max(30).optional().describe('Ordered non-overlapping source-time camera moves. x/y are normalized focus centers; captions remain screen anchored.'),
  transition: videoTransitionSchema.optional().describe('Fade through black at clip cuts; durationMs 0 disables. Does not change output duration.'),
  audioPath: z.string().min(1).max(4096).optional().describe('Absolute local PCM16 WAV path for import-audio. Requires external-request capability, like file upload.'),
  audioName: z.string().trim().min(1).max(80).optional(),
  audioProvenance: z.string().trim().min(1).max(240).optional().describe('Required for import-audio: source and rights permitting use in this exported clip.'),
  assetId: z.string().min(1).max(80).optional().describe('Imported asset to remove; remove its timeline events first.')
}
export const videoOptionsSchema = z.object(videoOptionsShape).strict()
export type VideoAnnotation = z.output<typeof videoAnnotationSchema>
export type VideoClip = z.output<typeof videoClipSchema>
export type VideoAudioEvent = z.output<typeof videoAudioEventSchema>
export type VideoCamera = z.output<typeof videoCameraSchema>
export type VideoTransition = z.output<typeof videoTransitionSchema>
export interface VideoAudioAsset { id: string; name: string; durationMs: number; provenance: string; builtin: boolean }
export type BrowserVideoOptions = z.input<typeof videoOptionsSchema>
/** Recording-relative monotonic milliseconds, not wall time or compositor timestamps. */
export interface VideoTimingObservation {
  clock: 'recording-monotonic'
  observedAtMs: number
  sourceTimeMs: number
  revision: number
  pixelTime: 'unknown'
  lastFrame?: {
    sequence: number
    sourceTimeMs: number
    captureStartedAtMs: number
    captureCompletedAtMs: number
    revision: number
  }
}
export interface BrowserVideoState {
  tabId: string
  recordingId?: string
  status: 'idle' | 'recording' | 'paused' | 'stopped' | 'rendering'
  durationMs: number
  timing?: VideoTimingObservation
  width: number
  height: number
  frameCount: number
  bytes: number
  annotations: VideoAnnotation[]
  clips: VideoClip[]
  audio?: VideoAudioEvent[]
  audioAssets?: VideoAudioAsset[]
  cameras?: VideoCamera[]
  transition?: VideoTransition
  notice?: string
  previewReady: boolean
  exported?: { filename: string; path: string; bytes: number; mimeType: 'video/webm'; codec: 'vp9'; audioCodec?: 'opus'; durationMs: number }
}
export interface VideoFrame { timeMs: number; data: Uint8Array }
export interface VideoRenderPlan { width: number; height: number; durationMs: number; annotations: VideoAnnotation[]; clips: VideoClip[]; audio?: VideoAudioEvent[]; cameras?: VideoCamera[]; transition?: VideoTransition }

/** Clips use source time, sorted and disjoint; annotations keep source coordinates and time. */
export function validateVideoEdit(durationMs: number, annotations: VideoAnnotation[], clips: VideoClip[]): void {
  if (annotations.some(a => a.endMs > durationMs)) throw new Error('Annotations must fit inside the recording')
  let previousEnd = 0
  for (const clip of clips) {
    if (clip.endMs > durationMs || clip.startMs < previousEnd) throw new Error('Clips must be ordered, non-overlapping, and inside the recording')
    previousEnd = clip.endMs
  }
}

export function videoSourceTime(clips: VideoClip[], outputMs: number): number {
  let remaining = outputMs
  for (const clip of clips) {
    const length = clip.endMs - clip.startMs
    if (remaining < length) return clip.startMs + remaining
    remaining -= length
  }
  return clips.at(-1)?.endMs ?? 0
}

/** Use an explicit frame duration so WebM readers also know the final frame's extent. */
export function videoFrameTiming(clips: VideoClip[]): { durationMs: number; frameCount: number; frameDurationMs: number; frameRate: number } {
  const durationMs = clips.reduce((sum, clip) => sum + clip.endMs - clip.startMs, 0)
  const frameCount = Math.max(1, Math.floor(durationMs * VIDEO_LIMITS.framesPerSecond / 1000))
  return { durationMs, frameCount, frameDurationMs: durationMs / frameCount, frameRate: frameCount * 1000 / durationMs }
}
