import { z } from 'zod'

export const incidentKinds = ['repro', 'network', 'diagnostics'] as const
export const incidentOmissionLimit = 10
export const incidentReplacementLimit = 10
export type IncidentKind = typeof incidentKinds[number]
export const incidentCaptureSchema = z.object({
  tabId: z.string().min(1).max(100),
  minutes: z.number().int().min(1).max(60),
  kinds: z.array(z.enum(incidentKinds)).min(1).max(3).refine(values => new Set(values).size === values.length)
}).strict()
export const incidentReviewSchema = z.object({
  draftId: z.string().uuid(),
  include: z.array(z.enum(incidentKinds)).min(1).max(3).refine(values => new Set(values).size === values.length),
  omitFields: z.array(z.string().min(1).max(256)).max(incidentOmissionLimit).refine(values => new Set(values).size === values.length).optional(),
  replacements: z.array(z.object({ find: z.string().min(1).max(256), replacement: z.string().max(256) }).strict()).max(incidentReplacementLimit)
}).strict()
export interface IncidentArtifact {
  kind: IncidentKind
  status: 'available' | 'empty' | 'unavailable' | 'oversize'
  truncated: boolean
  text?: string
}
export interface IncidentDraft {
  draftId: string
  capturedAt: string
  windowStart: string
  expiresAt: string
  artifacts: IncidentArtifact[]
}
export interface IncidentPreview {
  previewId: string
  html: string
  sha256: string
  bytes: number
}
export type IncidentCaptureInput = z.infer<typeof incidentCaptureSchema>
export type IncidentReviewInput = z.infer<typeof incidentReviewSchema>
