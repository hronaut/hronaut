import { mcpWorkspaceState, textResult, toolDescription, urlDetailOmitted } from '../../tool-results.js'
import type { McpToolContext } from '../tool-context.js'
import { getMcpGroupState, tabBelongsToMcpGroup } from '../../../browser/workspace-scope/workspace-scope.js'

export function registerBrowserStatus(context: McpToolContext): void {
  const { getUserAttention, manager, registerWorkspaceTool, tool } = context
  registerWorkspaceTool(
    'browser_status',
    { description: toolDescription('browser_status'), inputSchema: {} },
    tool(async ({ workspaceId }: { workspaceId?: string }) => {
      const attention = getUserAttention()
      const visibleAttention = attention && (
        (attention.workspaceId === workspaceId
          && (attention.tabId === undefined || tabBelongsToMcpGroup(manager, workspaceId!, attention.tabId)))
        || (attention.workspaceId === undefined
          && attention.tabId !== undefined
          && tabBelongsToMcpGroup(manager, workspaceId!, attention.tabId))
      ) ? attention : null
      return textResult({ ...mcpWorkspaceState(getMcpGroupState(manager, workspaceId!), urlDetailOmitted(manager)), userAttention: visibleAttention })
    }),
    { recordsReadiness: () => true, tabTarget: 'none', continuityInspection: () => true, pageOrigins: 'all-tabs' }
  )
}
