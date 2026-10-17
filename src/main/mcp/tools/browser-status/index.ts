import { mcpWorkspaceState, textResult, toolDescription } from '../../tool-results.js'
import type { McpToolContext } from '../tool-context.js'

export function registerBrowserStatus(context: McpToolContext): void {
  const { getUserAttention, manager, registerWorkspaceTool, tool } = context
  registerWorkspaceTool(
    'browser_status',
    { description: toolDescription('browser_status'), inputSchema: {} },
    tool(async ({ workspaceId }: { workspaceId?: string }) => {
      const attention = getUserAttention()
      const visibleAttention = attention && (
        (attention.workspaceId === workspaceId
          && (attention.tabId === undefined || manager.tabBelongsToMcpGroup(workspaceId!, attention.tabId)))
        || (attention.workspaceId === undefined
          && attention.tabId !== undefined
          && manager.tabBelongsToMcpGroup(workspaceId!, attention.tabId))
      ) ? attention : null
      return textResult({ ...mcpWorkspaceState(manager.getMcpGroupState(workspaceId!)), userAttention: visibleAttention })
    }),
    { recordsReadiness: () => true }
  )
}
