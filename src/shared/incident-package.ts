import { z } from 'zod'

export const incidentKinds = ['repro', 'network', 'diagnostics'] as const
export const incidentOmissionLimit = 10
export const incidentReplacementLimit = 10
export const incidentPathOmissionLimit = 10
export const incidentPathByteLimit = 4096
export const incidentLiteralPathSchema = z.array(z.union([
  z.string().max(256), z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)
])).min(1).max(16).refine(path => new TextEncoder().encode(JSON.stringify(path)).byteLength <= incidentPathByteLimit)
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
  omitPaths: z.array(z.object({ artifact: z.enum(incidentKinds), path: incidentLiteralPathSchema }).strict()).max(incidentPathOmissionLimit).optional(),
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
