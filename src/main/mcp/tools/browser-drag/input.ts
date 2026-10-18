import { z } from 'zod'
import { tabIdSchema } from '../../tool-schemas.js'

/** The fields browser_drag takes besides the workspace and review fields every workspace tool adds. */
export const browserDragInputShape = {
  tabId: tabIdSchema.optional(),
  sourceRef: z.string().optional(),
  sourceSelector: z.string().optional(),
  targetRef: z.string().optional(),
  targetSelector: z.string().optional(),
  startX: z.number().finite().nonnegative().optional(),
  startY: z.number().finite().nonnegative().optional(),
  endX: z.number().finite().nonnegative().optional(),
  endY: z.number().finite().nonnegative().optional(),
  modifiers: z.array(z.enum(['Shift', 'Alt', 'ControlOrMeta'])).min(1).max(3).optional()
    .describe('Keys for this one drag, such as Shift to constrain movement or Alt for alternate snapping; ControlOrMeta is Meta on macOS and Control elsewhere. Each key once. The page sees them on every mouse event of the drag, from press through release; no key events are sent.')
}

const MODIFIER_ORDER = ['Shift', 'Alt', 'ControlOrMeta']

/**
 * Rejects a key named twice and sorts the keys into one order, so review and
 * capability hashes ignore how a call lists them. Calls without modifiers
 * parse exactly as before. Refinement acts on Zod's parsed copy, not caller
 * data.
 */
export function browserDragSchema(shape: Record<string, z.ZodType>): z.ZodObject<Record<string, z.ZodType>> {
  return z.object(shape).superRefine((input, context) => {
    if (!Array.isArray(input.modifiers)) return
    const modifiers: unknown[] = input.modifiers
    if (new Set(modifiers).size !== modifiers.length) {
      context.addIssue({ code: 'custom', path: ['modifiers'], message: 'Name each drag modifier once.' })
    }
    modifiers.sort((left, right) => MODIFIER_ORDER.indexOf(String(left)) - MODIFIER_ORDER.indexOf(String(right)))
  })
}
