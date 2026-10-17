import { z } from 'zod'
import { textResult, toolDescription } from '../../tool-results.js'
import { tabIdSchema } from '../../tool-schemas.js'
import type { McpToolContext } from '../tool-context.js'

export function registerBrowserZoom(context: McpToolContext): void {
  const { manager, registerWorkspaceTool, tabTool } = context
  registerWorkspaceTool(
    'browser_zoom',
    {
      description: toolDescription('browser_zoom'),
      inputSchema: {
        tabId: tabIdSchema.optional(),
        action: z.enum(['in', 'out', 'reset', 'set']).default('reset'),
        percent: z.number().int().min(50).max(400).optional()
      }
    },
    tabTool('browser_zoom', async ({ tabId, action, percent }: {
      tabId?: string
      action: 'in' | 'out' | 'reset' | 'set'
      percent?: number
    }) => textResult(await manager.setZoom({ tabId, action, percent })))
  )
}
