import { z } from 'zod'

/** Expectations are supplied intentionally, never inferred from captured page text. */
export const reproCheckpointSchema = z.object({
  context: z.string().uuid(),
  selector: z.string().trim().min(1).max(500),
  condition: z.enum(['visible', 'hidden', 'text']),
  text: z.string().max(240).optional(),
  reviewed: z.literal(true)
}).strict().superRefine((value, ctx) => {
  if (value.condition === 'text' ? value.text === undefined : value.text !== undefined) {
    ctx.addIssue({ code: 'custom', message: 'Provide approved text only for a text expectation' })
  }
})

export type BrowserReproCheckpointInput = z.infer<typeof reproCheckpointSchema>

export interface BrowserReproExpectation {
  condition: 'visible' | 'hidden' | 'text'
  text?: string
  observedMatch: boolean
}
