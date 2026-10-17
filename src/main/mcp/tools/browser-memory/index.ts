import { z } from 'zod'
import { textResult, toolDescription } from '../../tool-results.js'
import { tabIdSchema } from '../../tool-schemas.js'
import type { McpToolContext } from '../tool-context.js'

export function registerBrowserMemory(context: McpToolContext): void {
  const { manager, registerWorkspaceTool, tabTool } = context
  registerWorkspaceTool(
    'browser_memory',
    {
      description: toolDescription('browser_memory'),
      inputSchema: {
        tabId: tabIdSchema.optional(),
        action: z.enum([
          'measure',
          'set-baseline',
          'clear-baseline',
          'start-allocation-sampling',
          'stop-allocation-sampling',
          'clear-allocation-sampling'
        ]).default('measure'),
        collectGarbage: z.boolean().default(false)
      }
    },
    tabTool('browser_memory', async ({
      tabId,
      action,
      collectGarbage
    }: {
      tabId?: string
      action:
        | 'measure'
        | 'set-baseline'
        | 'clear-baseline'
        | 'start-allocation-sampling'
        | 'stop-allocation-sampling'
        | 'clear-allocation-sampling'
      collectGarbage: boolean
    }) => textResult(await manager.memoryReport({ tabId, action, collectGarbage })))
  )
}
