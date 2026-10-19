import { z } from 'zod'
import { LOGPOINT_ACTIONS, LOGPOINT_LIMITS, type LogpointAction, type LogpointRequest } from '../../../../shared/logpoint.js'
import { textResult, toolDescription } from '../../tool-results.js'
import { tabIdSchema } from '../../tool-schemas.js'
import type { McpToolContext } from '../tool-context.js'

const probeSchema = z.object({
  url: z.string().min(1).max(LOGPOINT_LIMITS.maxUrlChars).optional()
    .describe('The script\'s address as scripts lists it; with source, chooses between scripts that map the same source'),
  source: z.string().min(1).max(LOGPOINT_LIMITS.maxSourceChars).optional()
    .describe('A source the script\'s source map lists, or the end of its path, such as src/cart.ts'),
  line: z.number().int().min(1).max(LOGPOINT_LIMITS.maxLine).describe('1-based line in the source, or in the script without source'),
  column: z.number().int().min(1).max(LOGPOINT_LIMITS.maxColumn).optional().describe('1-based column; default the first code on the line'),
  expression: z.string().min(1).max(LOGPOINT_LIMITS.maxExpressionChars)
    .describe('JavaScript read in the paused frame at each hit, such as total or [order.id, items.length]; anything with side effects is refused')
}).strict()

export function registerBrowserLogpoint(context: McpToolContext): void {
  const { manager, registerWorkspaceTool, tabTool } = context
  registerWorkspaceTool(
    'browser_logpoint',
    {
      description: toolDescription('browser_logpoint'),
      inputSchema: {
        tabId: tabIdSchema,
        action: z.enum(LOGPOINT_ACTIONS).default('get'),
        probes: z.array(probeSchema).min(1).max(LOGPOINT_LIMITS.maxProbes).optional()
          .describe(`With add: 1 to ${LOGPOINT_LIMITS.maxProbes} logpoints, replacing any the tab has`),
        maxHits: z.number().int().min(1).max(LOGPOINT_LIMITS.maxHits).optional()
          .describe(`With add: hits each logpoint records before it stops; default ${LOGPOINT_LIMITS.defaultHits}`),
        durationMs: z.number().int().min(LOGPOINT_LIMITS.minDurationMs).max(LOGPOINT_LIMITS.maxDurationMs).optional()
          .describe(`With add: how long the logpoints stay armed; default ${LOGPOINT_LIMITS.defaultDurationMs}`)
      }
    },
    tabTool('browser_logpoint', async ({ tabId, action, probes, maxHits, durationMs }: {
      tabId: string
      action: LogpointAction
      probes?: LogpointRequest[]
      maxHits?: number
      durationMs?: number
    }, call) => {
      if (action !== 'add' && (probes !== undefined || maxHits !== undefined || durationMs !== undefined)) {
        throw new Error('probes, maxHits and durationMs are only for action add')
      }
      if (action === 'add' && probes === undefined) throw new Error('add needs probes')
      // Checked at every hit and while armed, without renewing the agent's write ownership.
      const authority = { assertCurrent: (origin: string) => call.validateLifecycle(origin) }
      return textResult(await manager.logpoint(tabId, action, { probes, maxHits, durationMs, authority }))
    }),
    { readOnly: input => input.action === 'scripts' }
  )
}
