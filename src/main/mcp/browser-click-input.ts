import { z } from 'zod'

const MODIFIER_ORDER = ['Shift', 'Control', 'Meta', 'ControlOrMeta']

/** Preserve legacy omitted/left calls and their normalized hashes. Inspect extra
 * fields before stripping so an unknown field cannot silently drop from a right
 * click, and accept modifier keys only on one native semantic left click, each
 * named once and ControlOrMeta without Control or Meta. Modifiers are sorted
 * into one order, so review and capability hashes ignore how a call lists
 * them. Refinement acts on Zod's parsed copy, not caller data. */
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
    if (input.modifiers !== undefined) {
      const modifiers = Array.isArray(input.modifiers) ? input.modifiers : []
      if (new Set(modifiers).size !== modifiers.length || input.native !== true || input.button === 'right'
        || (modifiers.includes('ControlOrMeta') && (modifiers.includes('Control') || modifiers.includes('Meta')))
        || Boolean(input.ref) === Boolean(input.selector) || input.x !== undefined || input.y !== undefined
        || input.doubleClick === true || input.dialogAction !== undefined || input.promptText !== undefined) {
        context.addIssue({ code: 'custom', message: 'Modifiers require native=true and exactly one ref or selector, each modifier named once and ControlOrMeta not combined with Control or Meta; coordinates, double-click, right-click and dialogs are unsupported.' })
      }
      modifiers.sort((left, right) => MODIFIER_ORDER.indexOf(String(left)) - MODIFIER_ORDER.indexOf(String(right)))
    }
    for (const key of unknown) delete input[key]
  })
}
