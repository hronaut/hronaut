import { z } from 'zod'
import { textResult, toolDescription } from '../../tool-results.js'
import { tabIdSchema } from '../../tool-schemas.js'
import type { McpToolContext } from '../tool-context.js'

export function registerBrowserDebugReport(context: McpToolContext): void {
  const { manager, registerWorkspaceTool, tabTool } = context
  registerWorkspaceTool(
    'browser_debug_report',
    {
      description: toolDescription('browser_debug_report'),
      inputSchema: {
        tabId: tabIdSchema.optional(),
        maxConsoleMessages: z.number().int().min(0).max(100).optional(),
        maxNetworkRequests: z.number().int().min(0).max(100).optional(),
        includeSuccessfulRequests: z.boolean().optional()
      }
    },
    tabTool('browser_debug_report', async ({
      tabId,
      maxConsoleMessages,
      maxNetworkRequests,
      includeSuccessfulRequests
    }: {
      tabId?: string
      maxConsoleMessages?: number
      maxNetworkRequests?: number
      includeSuccessfulRequests?: boolean
    }) => textResult(manager.debugReport({
      tabId,
      maxConsoleMessages,
      maxNetworkRequests,
      includeSuccessfulRequests
    })))
  )
}
