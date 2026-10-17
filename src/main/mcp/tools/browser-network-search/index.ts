import { z } from 'zod'
import { textResult, toolDescription } from '../../tool-results.js'
import { tabIdSchema } from '../../tool-schemas.js'
import type { McpToolContext } from '../tool-context.js'

export function registerBrowserNetworkSearch(context: McpToolContext): void {
  const { manager, registerWorkspaceTool, tabTool } = context
  registerWorkspaceTool(
    'browser_network_search',
    {
      description: toolDescription('browser_network_search'),
      inputSchema: {
        tabId: tabIdSchema.optional(),
        query: z.string().min(1).max(200),
        caseSensitive: z.boolean().optional(),
        maxResults: z.number().int().min(1).max(100).optional(),
        maxRequests: z.number().int().min(1).max(100).optional(),
        maxBodyChars: z.number().int().min(1_000).max(50_000).optional()
      }
    },
    tabTool('browser_network_search', async (options: {
      tabId?: string
      query: string
      caseSensitive?: boolean
      maxResults?: number
      maxRequests?: number
      maxBodyChars?: number
    }) => textResult(await manager.networkSearch(options)))
  )
}
