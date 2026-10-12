import { z } from 'zod'

export const fileEvaluationSourceSchema = z.object({
  path: z.string().min(1).max(4095),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  workspaceId: z.uuid(),
  tabId: z.string().min(1),
  expectedOrigin: z.string().refine(value => {
    try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && url.origin === value } catch { return false }
  })
}).strict()
export type FileEvaluationSource = z.infer<typeof fileEvaluationSourceSchema>
export interface FileEvaluationHooks {
  signal?: AbortSignal
  validate(): void
  retainPublication(authority: { validate(): void; dispose(): void }): void
  retainCompletion(completion: Promise<void>): void
  submitted(): void
}
export interface FileEvaluationProgress { submitted: boolean; acknowledged: boolean }
export function fileEvaluationFailure(progress: FileEvaluationProgress, reason = 'UNAVAILABLE') {
  return {
    status: progress.submitted ? 'OUTCOME_UNKNOWN' : 'NOT_DISPATCHED',
    reason,
    effects: progress.submitted ? 'possible' : 'none',
    submitted: progress.submitted,
    acknowledged: progress.acknowledged,
    retrySafe: false,
    nextAction: 'Inspect current authority and application state. Never automatically replay file evaluation.'
  }
}
