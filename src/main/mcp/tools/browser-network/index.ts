import { z } from 'zod'
import { filterNetworkRequests, normalizeNetworkHarOptions } from '../../../../shared/network-har.js'
import { sortNetworkRequests } from '../../../../shared/network-request-sort.js'
import type { BrowserNetworkRequestSortBy, BrowserNetworkRequestSortDirection } from '../../../../shared/types.js'
import { textResult, toolDescription } from '../../tool-results.js'
import { NETWORK_FILTER_QUERY_DESCRIPTION, tabIdSchema } from '../../tool-schemas.js'
import type { McpToolContext } from '../tool-context.js'

export function registerBrowserNetwork(context: McpToolContext): void {
  const { manager, registerWorkspaceTool, tabTool } = context
  registerWorkspaceTool(
    'browser_network',
    {
      description: toolDescription('browser_network'),
      inputSchema: {
        tabId: tabIdSchema.optional(),
        query: z.string().max(500).optional().describe(NETWORK_FILTER_QUERY_DESCRIPTION),
        resourceType: z.string().optional(),
        sortBy: z.enum(['start-time', 'end-time', 'duration', 'waiting', 'size', 'status']).optional(),
        sortDirection: z.enum(['asc', 'desc']).optional(),
        limit: z.number().int().min(1).max(500).optional(),
        clear: z.boolean().optional()
      }
    },
    tabTool('browser_network', async ({
      tabId,
      query,
      resourceType,
      sortBy,
      sortDirection,
      limit,
      clear
    }: {
      tabId?: string
      query?: string
      resourceType?: string
      sortBy?: BrowserNetworkRequestSortBy
      sortDirection?: BrowserNetworkRequestSortDirection
      limit?: number
      clear?: boolean
    }) => {
      const requests = await manager.networkRequests(tabId, clear)
      const filtered = filterNetworkRequests(requests, normalizeNetworkHarOptions({ query, resourceType }))
      const sorted = sortNetworkRequests(filtered, sortBy, sortDirection)
      return textResult(limit === undefined ? sorted : sorted.slice(0, limit))
    })
  )
}
