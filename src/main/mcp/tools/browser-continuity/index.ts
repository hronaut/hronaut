import { z } from 'zod'
import { textResult, toolDescription } from '../../tool-results.js'
import { workspaceIdSchema } from '../../tool-schemas.js'
import type { McpToolContext } from '../tool-context.js'

export function registerBrowserContinuity(context: McpToolContext): void {
  const { manager, registerTool, requireAgentWorkspace, tool } = context
  registerTool(
    'browser_continuity',
    {
      description: toolDescription('browser_continuity'),
      inputSchema: {
        workspaceId: workspaceIdSchema,
        action: z.enum(['checkpoint', 'status', 'reconcile']),
        reviewId: z.uuid().optional(),
        acknowledgeUnknownOutcome: z.boolean().optional(),
        markerSelector: z.string().min(1).max(256).optional()
      }
    },
    tool(async ({ workspaceId, action, reviewId, acknowledgeUnknownOutcome, markerSelector }: { workspaceId: string; action: 'checkpoint' | 'status' | 'reconcile'; reviewId?: string; acknowledgeUnknownOutcome?: boolean; markerSelector?: string }) => {
      requireAgentWorkspace(workspaceId)
      if (markerSelector !== undefined && action !== 'checkpoint') throw new TypeError('markerSelector is only accepted when creating a checkpoint')
      if (action === 'checkpoint') return textResult({ checkpointId: await manager.armWorkspaceContinuity(workspaceId, markerSelector, () => requireAgentWorkspace(workspaceId)) })
      if (action === 'reconcile') {
        if (!reviewId) throw new TypeError('reviewId is required to reconcile continuity')
        await manager.reconcileWorkspaceContinuity(workspaceId, reviewId, acknowledgeUnknownOutcome === true, () => requireAgentWorkspace(workspaceId))
      }
      const report = await manager.inspectWorkspaceContinuity(workspaceId)
      requireAgentWorkspace(workspaceId)
      return textResult(report)
    })
  )
}
