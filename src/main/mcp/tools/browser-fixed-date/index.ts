import { z } from 'zod'
import { FIXED_DATE_ACTIONS, FIXED_DATE_MAX_EPOCH_MS, type FixedDateAction } from '../../../../shared/fixed-date.js'
import { textResult, toolDescription } from '../../tool-results.js'
import { tabIdSchema } from '../../tool-schemas.js'
import type { McpToolContext } from '../tool-context.js'

/** An ISO 8601 instant with a date, a time and an explicit Z or UTC offset, so it never depends on a time zone. */
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/

/** The instant to stage, from exactly one of an ISO 8601 instant or UTC epoch milliseconds. */
function stagedEpochMs(at: string | undefined, epochMs: number | undefined): number {
  if ((at === undefined) === (epochMs === undefined)) throw new Error('Give exactly one of at (an ISO 8601 instant such as 2026-12-31T23:59:30Z) or epochMs to stage a fixed Date')
  if (epochMs !== undefined) return epochMs
  const parsed = ISO_INSTANT.test(at!) ? Date.parse(at!) : Number.NaN
  if (!Number.isFinite(parsed)) throw new Error('at must be an ISO 8601 instant with a date, a time and Z or a UTC offset, such as 2026-12-31T23:59:30Z')
  return parsed
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
      return textResult(manager.fixedDate(tabId, action, instant, { assertCurrent: call.requireCurrentTarget }))
    }, 'never')
  )
}
