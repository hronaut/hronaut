import { publicBrowserReconciliation, textResult, toolDescription } from '../../tool-results.js'
import { type ReconciliationConditionRequest, reconciliationRequestSchema, tabIdSchema } from '../../tool-schemas.js'
import type { McpToolContext } from '../tool-context.js'

export function registerBrowserReconciliation(context: McpToolContext): void {
  const { manager, registerWorkspaceTool, requireAgentWorkspace, tabTool } = context
  registerWorkspaceTool(
    'browser_reconciliation',
    {
      description: toolDescription('browser_reconciliation'),
      inputSchema: {
        tabId: tabIdSchema.optional(),
        ...reconciliationRequestSchema.shape
      }
    },
    tabTool('browser_reconciliation', async (input: ReconciliationConditionRequest & {
      workspaceId: string
      tabId: string
      logicalItemKey: string
      targetIdentity: string
      sourceRevision: string
    }) => {
      const evidence = await manager.readBrowserReconciliation(
        input.workspaceId,
        input.tabId,
        input,
        () => { requireAgentWorkspace(input.workspaceId) }
      )
      return textResult(publicBrowserReconciliation(input, evidence))
    }),
    { continuityInspection: () => true }
  )
}
