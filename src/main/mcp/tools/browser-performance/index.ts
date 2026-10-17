import { z } from 'zod'
import { textResult, toolDescription } from '../../tool-results.js'
import { tabIdSchema } from '../../tool-schemas.js'
import type { McpToolContext } from '../tool-context.js'

export function registerBrowserPerformance(context: McpToolContext): void {
  const { manager, registerWorkspaceTool, tabTool } = context
  registerWorkspaceTool(
    'browser_performance',
    {
      description: toolDescription('browser_performance'),
      inputSchema: {
        tabId: tabIdSchema.optional(),
        settleMs: z.number().int().min(0).max(2_000).optional(),
        action: z.enum(['measure', 'set-baseline', 'clear-baseline']).optional()
      }
    },
    tabTool('browser_performance', async ({
      tabId,
      settleMs,
      action
    }: {
      tabId?: string
      settleMs?: number
      action?: 'measure' | 'set-baseline' | 'clear-baseline'
    }) => textResult(await manager.performanceReport({ tabId, settleMs, action })))
  )
}
