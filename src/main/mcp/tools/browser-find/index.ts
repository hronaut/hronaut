import { z } from 'zod'
import { textResult, toolDescription } from '../../tool-results.js'
import { tabIdSchema } from '../../tool-schemas.js'
import type { McpToolContext } from '../tool-context.js'

export function registerBrowserFind(context: McpToolContext): void {
  const { manager, registerWorkspaceTool, tabTool } = context
  registerWorkspaceTool(
    'browser_find',
    {
      description: toolDescription('browser_find'),
      inputSchema: {
        tabId: tabIdSchema.optional(),
        rootSelector: z.string().trim().min(1).max(512).optional()
          .describe('Search only this unique non-editable light-DOM component, plus page URL/title context. No whole-page fallback; absence is scoped.'),
        query: z.string().trim().min(1).max(200),
        caseSensitive: z.boolean().optional(),
        maxMatches: z.number().int().min(1).max(50).optional(),
        contextChars: z.number().int().min(20).max(500).optional()
      }
    },
    tabTool('browser_find', async (options: {
      tabId?: string
      rootSelector?: string
      query: string
      caseSensitive?: boolean
      maxMatches?: number
      contextChars?: number
    }) => textResult(await manager.findSnapshot(options))),
    { continuityInspection: () => true }
  )
}
