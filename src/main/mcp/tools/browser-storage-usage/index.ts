import type { StorageInspectionHooks } from '../../../browser/storage-inspection-operation.js'
import { textResult, toolDescription } from '../../tool-results.js'
import { tabIdSchema } from '../../tool-schemas.js'
import type { McpToolContext } from '../tool-context.js'

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
    tabTool('browser_storage_usage', async ({ tabId, storageInspectionHooks }: { tabId?: string; storageInspectionHooks?: StorageInspectionHooks }) =>
      textResult(await manager.inspectStorageUsage(tabId, storageInspectionHooks))
    )
  )
}
