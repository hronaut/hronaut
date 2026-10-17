import { z } from 'zod'
import { textResult, toolDescription } from '../../tool-results.js'
import { tabIdSchema } from '../../tool-schemas.js'
import type { McpToolContext } from '../tool-context.js'

export function registerBrowserPwa(context: McpToolContext): void {
  const { manager, registerWorkspaceTool, tabTool } = context
  registerWorkspaceTool(
    'browser_pwa',
    {
      description: toolDescription('browser_pwa'),
      inputSchema: {
        tabId: tabIdSchema.optional(),
        cacheName: z.string().min(1).max(512).optional()
          .describe('Select one Cache Storage cache by its current website-authored name.'),
        query: z.string().max(512).default('')
          .describe('Filter selected-cache entries by a request URL path substring.'),
        offset: z.number().int().min(0).max(10_000).default(0),
        limit: z.number().int().min(1).max(100).default(50),
        includeHeaders: z.boolean().default(false)
          .describe('Include bounded, redacted request and response headers. Cached response bodies are never returned.')
      }
    },
    tabTool('browser_pwa', async ({ tabId, cacheName, query, offset, limit, includeHeaders }: {
      tabId?: string
      cacheName?: string
      query: string
      offset: number
      limit: number
      includeHeaders: boolean
    }) => textResult(await manager.inspectPwa({ tabId, cacheName, query, offset, limit, includeHeaders })))
  )
}
