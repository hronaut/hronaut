import { z } from 'zod'
import { textResult, toolDescription } from '../../tool-results.js'
import { tabIdSchema } from '../../tool-schemas.js'
import type { McpToolContext } from '../tool-context.js'

export function registerBrowserScroll(context: McpToolContext): void {
  const { manager, registerWorkspaceTool, tabTool } = context
  registerWorkspaceTool(
    'browser_scroll',
    {
      description: toolDescription('browser_scroll'),
      inputSchema: {
        tabId: tabIdSchema.optional(),
        ref: z.string().optional(),
        selector: z.string().optional(),
        deltaX: z.number().int().min(-100_000).max(100_000).optional(),
        deltaY: z.number().int().min(-100_000).max(100_000).optional()
      }
    },
    tabTool('browser_scroll', async (input: { tabId?: string; ref?: string; selector?: string; deltaX?: number; deltaY?: number }) =>
      textResult(await manager.scroll(input))
    )
  )
}
