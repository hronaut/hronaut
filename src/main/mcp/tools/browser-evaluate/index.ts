import { z } from 'zod'
import { safeValue, textResult, toolDescription } from '../../tool-results.js'
import { tabIdSchema } from '../../tool-schemas.js'
import type { McpToolContext } from '../tool-context.js'

export function registerBrowserEvaluate(context: McpToolContext): void {
  const { manager, registerWorkspaceTool, tabTool } = context
  registerWorkspaceTool(
    'browser_evaluate',
    {
      description: toolDescription('browser_evaluate'),
      inputSchema: {
        script: z.string().min(1),
        tabId: tabIdSchema.optional(),
        dialogAction: z.enum(['accept', 'dismiss']).optional()
      }
    },
    tabTool('browser_evaluate', async ({ script, tabId, dialogAction }: {
      script: string
      tabId?: string
      dialogAction?: 'accept' | 'dismiss'
    }) =>
      textResult(safeValue(await manager.evaluate(script, tabId, { dialogAction })))
    )
  )
}
