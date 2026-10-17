import type { StorageInspectionHooks } from '../../../browser/storage-inspection-operation.js'
import { textResult, toolDescription } from '../../tool-results.js'
import { tabIdSchema } from '../../tool-schemas.js'
import { type StorageInspectionSettlement, storageInspectionSettlement } from '../storage-inspection-settlement.js'
import type { McpToolContext, WorkspaceToolCall } from '../tool-context.js'

export function registerBrowserStorageUsage(context: McpToolContext): void {
  const { manager, registerWorkspaceTool, tabTool } = context
  registerWorkspaceTool(
    'browser_storage_usage',
    {
      description: toolDescription('browser_storage_usage'),
      inputSchema: {
        tabId: tabIdSchema.optional().describe('Tab in your current workspace. Defaults to the workspace active tab.')
      }
    },
    tabTool('browser_storage_usage', async ({ tabId }: { tabId?: string }, call: WorkspaceToolCall<StorageInspectionSettlement>) => {
      const storageInspectionHooks = {
        validate: () => {
          try {
            if (call.signal?.aborted) throw new Error('Storage inspection cancelled')
            call.requireCurrentTarget()
          } catch (error) { call.rememberInputPolicy(error); throw error }
        },
        readStarted: call.settlement.markStarted,
        retainPublication: call.settlement.retainPublication
      } satisfies StorageInspectionHooks
      return textResult(await manager.inspectStorageUsage(tabId, storageInspectionHooks))
    }),
    { settlement: () => storageInspectionSettlement() }
  )
}
