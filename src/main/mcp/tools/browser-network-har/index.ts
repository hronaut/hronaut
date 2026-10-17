import { z } from 'zod'
import { textResult, toolDescription } from '../../tool-results.js'
import { NETWORK_FILTER_QUERY_DESCRIPTION, tabIdSchema } from '../../tool-schemas.js'
import type { McpToolContext } from '../tool-context.js'

export function registerBrowserNetworkHar(context: McpToolContext): void {
  const { manager, registerWorkspaceTool, tabTool } = context
  registerWorkspaceTool(
    'browser_network_har',
    {
      description: toolDescription('browser_network_har'),
      inputSchema: {
        tabId: tabIdSchema.optional(),
        query: z.string().max(500).optional().describe(NETWORK_FILTER_QUERY_DESCRIPTION),
        resourceType: z.string().max(64).optional(),
        errorsOnly: z.boolean().optional(),
        includeBodies: z.boolean().optional(),
        maxRequests: z.number().int().min(1).max(200).optional(),
        maxBodyChars: z.number().int().min(1_000).max(20_000).optional(),
        saveToDownloads: z.boolean().optional(),
        filename: z.string().min(1).max(180).optional()
      }
    },
    tabTool('browser_network_har', async ({ saveToDownloads, filename, ...options }: {
      tabId?: string
      query?: string
      resourceType?: string
      errorsOnly?: boolean
      includeBodies?: boolean
      maxRequests?: number
      maxBodyChars?: number
      saveToDownloads?: boolean
      filename?: string
    }) => textResult(saveToDownloads
      ? await manager.saveNetworkHar({ ...options, filename })
      : await manager.networkHar(options)))
  )
}
