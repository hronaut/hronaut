import { z } from 'zod'
import type { StorageComparisonHooks } from '../../../browser/storage-comparison-operation.js'
import { textResult, toolDescription } from '../../tool-results.js'
import { tabIdSchema } from '../../tool-schemas.js'
import type { McpToolContext, WorkspaceToolCall } from '../tool-context.js'
import { type StorageComparisonSettlement, storageComparisonSettlement } from './storage-comparison-settlement.js'

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
    tabTool('browser_storage_changes', async ({ tabId, action, includeValues }: {
      tabId?: string
      action: 'get' | 'baseline' | 'compare' | 'clear'
      includeValues: boolean
    }, call: WorkspaceToolCall<StorageComparisonSettlement>) => {
      const storageComparisonHooks = {
        validate: () => {
          try {
            if (call.signal?.aborted) throw new Error('Storage comparison cancelled')
            call.requireCurrentTarget()
          } catch (error) { call.rememberInputPolicy(error); throw error }
        },
        started: call.settlement.markStarted,
        comparisonChanged: call.settlement.markChanged,
        retainPublication: call.settlement.retainPublication
      } satisfies StorageComparisonHooks
      return textResult(await manager.storageChanges(action, tabId, includeValues, storageComparisonHooks))
    }),
    { settlement: () => storageComparisonSettlement() }
  )
}
