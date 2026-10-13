import { z } from 'zod'

/** Preserve legacy omitted/left calls and their normalized hashes. Inspect extra
 * fields before stripping so a requested modifier cannot silently become a right
 * click without modifiers. Refinement acts on Zod's parsed copy, not caller data. */
export function browserClickSchema(shape: Record<string, z.ZodType>): z.ZodObject<Record<string, z.ZodType>> {
  return z.object(shape).catchall(z.unknown()).superRefine((input, context) => {
    const unknown = Object.keys(input).filter(key => !Object.hasOwn(shape, key))
    if (input.button === 'right') {
      if (unknown.length || typeof input.tabId !== 'string' || input.native !== true
        || Boolean(input.ref) === Boolean(input.selector) || input.x !== undefined || input.y !== undefined
        || input.doubleClick === true || input.dialogAction !== undefined || input.promptText !== undefined) {
        context.addIssue({ code: 'custom', message: 'Right-click requires native=true, explicit tabId and exactly one ref or selector; coordinates, double-click, dialogs and extra fields are unsupported.' })
      }
    }
    for (const key of unknown) delete input[key]
  })
}
