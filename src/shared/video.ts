import { z } from 'zod'

export const VIDEO_LIMITS = { durationMs: 120_000, framesPerSecond: 12, width: 1280, height: 720, bytes: 64 * 1024 * 1024, recordings: 3, annotations: 100, clips: 30 } as const
const time = z.number().finite().min(0).max(VIDEO_LIMITS.durationMs)
const point = z.number().finite().min(0).max(1)
export const videoAnnotationSchema = z.object({
  kind: z.enum(['text', 'arrow', 'highlight', 'click']),
  startMs: time,
  endMs: time,
  x: point,
  y: point,
  endX: point.optional(),
  endY: point.optional(),
  text: z.string().trim().min(1).max(240).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#ffcc33')
}).strict().refine(a => a.endMs > a.startMs, 'Annotation end must follow its start')
  .refine(a => a.kind !== 'text' || !!a.text, 'Text annotations require text')
  .refine(a => !['arrow', 'highlight'].includes(a.kind) || (a.endX !== undefined && a.endY !== undefined), 'Arrows and highlights require an end point')
export const videoClipSchema = z.object({ startMs: time, endMs: time }).strict()
  .refine(c => c.endMs > c.startMs, 'Clip end must follow its start')
export const videoOptionsShape = {
  tabId: z.string().min(1).max(128).optional(),
  action: z.enum(['get', 'start', 'pause', 'resume', 'stop', 'edit', 'render', 'export', 'clear']).default('get'),
  annotations: z.array(videoAnnotationSchema).max(VIDEO_LIMITS.annotations).optional(),
  clips: z.array(videoClipSchema).min(1).max(VIDEO_LIMITS.clips).optional()
}
export const videoOptionsSchema = z.object(videoOptionsShape).strict()
export type VideoAnnotation = z.output<typeof videoAnnotationSchema>
export type VideoClip = z.output<typeof videoClipSchema>
export type BrowserVideoOptions = z.input<typeof videoOptionsSchema>
export interface BrowserVideoState {
  tabId: string
  recordingId?: string
  status: 'idle' | 'recording' | 'paused' | 'stopped' | 'rendering'
  durationMs: number
  width: number
  height: number
  frameCount: number
  bytes: number
  annotations: VideoAnnotation[]
  clips: VideoClip[]
  notice?: string
  previewReady: boolean
  exported?: { filename: string; path: string; bytes: number; mimeType: 'video/webm'; codec: 'vp9'; durationMs: number }
}
export interface VideoFrame { timeMs: number; data: Uint8Array }
export interface VideoRenderPlan { width: number; height: number; durationMs: number; annotations: VideoAnnotation[]; clips: VideoClip[] }

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
