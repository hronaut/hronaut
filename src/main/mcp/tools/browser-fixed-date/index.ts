import { z } from 'zod'
import { FIXED_DATE_ACTIONS, FIXED_DATE_MAX_EPOCH_MS, type FixedDateAction } from '../../../../shared/fixed-date.js'
import { textResult, toolDescription } from '../../tool-results.js'
import { tabIdSchema } from '../../tool-schemas.js'
import type { McpToolContext } from '../tool-context.js'

/** An ISO 8601 instant with a date, a time and an explicit Z or UTC offset, so it never depends on a time zone. */
const ISO_INSTANT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(?:Z|([+-])(\d{2}):(\d{2}))$/

/**
 * The instant to stage, from exactly one of an ISO 8601 instant or UTC epoch
 * milliseconds. A calendar date or time that does not exist, such as February
 * 29 in a common year or 24:00, is refused instead of rolling over.
 */
export function stagedEpochMs(at: string | undefined, epochMs: number | undefined): number {
  if ((at === undefined) === (epochMs === undefined)) throw new Error('Give exactly one of at (an ISO 8601 instant such as 2026-12-31T23:59:30Z) or epochMs to stage a fixed Date')
  if (epochMs !== undefined) return epochMs
  const invalid = new Error('at must be an existing date and time in ISO 8601 with Z or a UTC offset, such as 2026-12-31T23:59:30Z')
  const match = ISO_INSTANT.exec(at!)
  if (!match) throw invalid
  const [year, month, day, hour, minute, second = 0, offsetHours = 0, offsetMinutes = 0] = [1, 2, 3, 4, 5, 6, 9, 10].map(group => match[group] === undefined ? undefined : Number(match[group]))
  const milliseconds = match[7] === undefined ? 0 : Number(match[7].padEnd(3, '0'))
  const fields = new Date(0)
  fields.setUTCFullYear(year!, month! - 1, day!)
  fields.setUTCHours(hour!, minute!, second, milliseconds)
  if (fields.getUTCFullYear() !== year || fields.getUTCMonth() !== month! - 1 || fields.getUTCDate() !== day
    || fields.getUTCHours() !== hour || fields.getUTCMinutes() !== minute || fields.getUTCSeconds() !== second
    || offsetHours! > 23 || offsetMinutes! > 59) throw invalid
  const offset = (match[8] === '-' ? -1 : 1) * (offsetHours! * 60 + offsetMinutes!) * 60_000
  const instant = fields.getTime() - offset
  if (!(Math.abs(instant) <= FIXED_DATE_MAX_EPOCH_MS)) throw invalid
  return instant
}

export function registerBrowserFixedDate(context: McpToolContext): void {
  const { registerWorkspaceTool, tabTool, manager } = context
  registerWorkspaceTool(
    'browser_fixed_date',
    {
      description: toolDescription('browser_fixed_date'),
      inputSchema: {
        tabId: tabIdSchema,
        action: z.enum(FIXED_DATE_ACTIONS),
        at: z.string().max(40).optional().describe('With stage: the instant, as ISO 8601 with Z or a UTC offset, such as 2026-12-31T23:59:30Z.'),
        epochMs: z.number().int().min(-FIXED_DATE_MAX_EPOCH_MS).max(FIXED_DATE_MAX_EPOCH_MS).optional()
          .describe('With stage, instead of at: the instant in UTC epoch milliseconds.')
      }
    },
    tabTool('browser_fixed_date', async ({ tabId, action, at, epochMs }: { tabId: string; action: FixedDateAction; at?: string; epochMs?: number }, call) => {
      const instant = action === 'stage' ? stagedEpochMs(at, epochMs) : undefined
      if (action !== 'stage' && (at !== undefined || epochMs !== undefined)) throw new Error('at and epochMs are only for action stage')
      // Checked again at each installation and status, without renewing the agent's write ownership.
      return textResult(manager.fixedDate(tabId, action, instant, { assertCurrent: origin => call.validateLifecycle(origin) }))
    }, 'never'),
    { readOnly: input => input.action === 'status' }
  )
}
