import { z } from 'zod'
import type { StorageComparisonHooks } from '../../../browser/storage-comparison-operation.js'
import { textResult, toolDescription } from '../../tool-results.js'
import { tabIdSchema } from '../../tool-schemas.js'
import type { McpToolContext } from '../tool-context.js'

export function registerBrowserStorageChanges(context: McpToolContext): void {
  const { manager, registerWorkspaceTool, tabTool } = context
  registerWorkspaceTool(
    'browser_storage_changes',
    {
      description: toolDescription('browser_storage_changes'),
      inputSchema: {
        tabId: tabIdSchema.optional(),
        action: z.enum(['get', 'baseline', 'compare', 'clear']).default('get')
          .describe('Set a baseline before the interaction, compare afterward, inspect the latest report, or clear it.'),
        includeValues: z.boolean().default(false)
          .describe('Include bounded before/after values when necessary. HttpOnly cookie values remain protected.')
      }
    },
    tabTool('browser_storage_changes', async ({ tabId, action, includeValues, storageComparisonHooks }: {
      storageComparisonHooks?: StorageComparisonHooks
      tabId?: string
      action: 'get' | 'baseline' | 'compare' | 'clear'
      includeValues: boolean
    }) => textResult(await manager.storageChanges(action, tabId, includeValues, storageComparisonHooks)))
  )
}
