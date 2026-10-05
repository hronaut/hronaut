import { z } from 'zod'
import { MAX_REPRO_COUNT, validReproCountSelector } from './repro-count.js'

/** Expectations are supplied intentionally, never inferred from captured page text. */
export const reproCheckpointSchema = z.object({
  context: z.string().uuid(),
  selector: z.string().trim().min(1).max(500),
  condition: z.enum(['visible', 'hidden', 'text', 'checked', 'unchecked', 'count']),
  count: z.number().int().min(0).max(MAX_REPRO_COUNT).optional(),
  text: z.string().max(240).optional(),
  reviewed: z.literal(true)
}).strict().superRefine((value, ctx) => {
  if (value.condition === 'count' ? value.count === undefined : value.count !== undefined) {
    ctx.addIssue({ code: 'custom', message: 'Provide an explicit count only for a count expectation' })
  }
  if (value.condition === 'count' && !validReproCountSelector(value.selector)) {
    ctx.addIssue({ code: 'custom', message: 'Count requires a canonical structural selector, such as ul > li' })
  }
  if (value.condition === 'text' ? value.text === undefined : value.text !== undefined) {
    ctx.addIssue({ code: 'custom', message: 'Provide approved text only for a text expectation' })
  }
})

export type BrowserReproCheckpointInput = z.infer<typeof reproCheckpointSchema>

export interface BrowserReproExpectation {
  condition: BrowserReproCheckpointInput['condition']
  count?: number
  text?: string
  observedMatch: boolean
}
