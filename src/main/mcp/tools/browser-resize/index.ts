import { z } from 'zod'
import { textResult, toolDescription } from '../../tool-results.js'
import { tabIdSchema } from '../../tool-schemas.js'
import type { McpToolContext } from '../tool-context.js'

export function registerBrowserResize(context: McpToolContext): void {
  const { manager, registerWorkspaceTool, tabTool } = context
  registerWorkspaceTool(
    'browser_resize',
    {
      description: toolDescription('browser_resize'),
      inputSchema: {
        tabId: tabIdSchema.optional(),
        width: z.number().int().min(320).max(7680).optional(),
        height: z.number().int().min(240).max(4320).optional(),
        reset: z.boolean().optional()
      }
    },
    tabTool('browser_resize', async ({ tabId, width, height, reset }: { tabId?: string; width?: number; height?: number; reset?: boolean }) =>
      textResult(await manager.resizeViewport(width, height, reset ?? false, tabId))
    )
  )
}
