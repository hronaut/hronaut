export const FRAME_OBSERVATION_LIMITS = { maxChars: 16000, defaultChars: 8000, envelopeBytes: 32768, nodes: 10000, depth: 100, durationMs: 100, deadlineMs: 1500 } as const
export type FrameObservationOmission = 'nested-frames' | 'shadow-dom' | 'private-editors' | 'offscreen-or-clipped' | 'uncertain-layout' | 'node-limit' | 'depth-limit' | 'duration-limit' | 'text-limit' | 'envelope-limit'
export interface BrowserFrameSnapshot {
  kind: 'frame-observation'
  formatVersion: 1
  captureId: string
  scope: 'direct-child-viewport'
  text: string
  untrusted: true
  completeness: { complete: boolean; omissions: FrameObservationOmission[]; absenceNotEstablished: true }
  limits: typeof FRAME_OBSERVATION_LIMITS
}
