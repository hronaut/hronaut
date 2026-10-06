import { z } from 'zod'

/** Operational bounds, not a Chromium RSS limit or native codec interruption guarantee. */
export const VIDEO_INSPECTION_LIMITS = {
  frames: 12, frameBytes: 4 * 1024 * 1024, selectedBytes: 8 * 1024 * 1024,
  width: 1280, height: 720, outputWidth: 2048, outputHeight: 2048,
  pngBytes: 4 * 1024 * 1024, deadlineMs: 5000, exitWaitMs: 1000,
  tileWidth: 512, tileHeight: 288, labelHeight: 24, columns: 3
} as const
export const videoInspectionFields = {
  recordingId: z.uuid(), expectedRevision: z.number().int().min(0),
  startMs: z.number().finite().min(0).max(120_000),
  endMs: z.number().finite().min(0).max(120_000),
  maxFrames: z.number().int().min(1).max(VIDEO_INSPECTION_LIMITS.frames)
}
export const videoInspectionSchema = z.object({
  action: z.literal('inspect'), tabId: z.string().min(1).max(128).optional(), ...videoInspectionFields
}).strict().refine(value => value.endMs >= value.startMs, 'Inspection end must not precede start')
export type BrowserVideoInspectionOptions = z.infer<typeof videoInspectionSchema>
export interface VideoInspectionReport {
  recordingId: string
  revision: number
  status: 'sheet' | 'empty'
  interval: { startMs: number; endMs: number; inclusive: true }
  retainedFrames: number
  selectedFrames: number
  omittedFrames: number
  sampling: 'retained-index-uniform'
  clock: 'recording-source'
  pixelTime: 'unknown'
  frames: { label: number; sequence: number; sourceTimeMs: number }[]
  image?: { width: number; height: number; mimeType: 'image/png' }
  notice: string
}
