import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import { textResult, toolDescription } from '../../tool-results.js'
import { workspaceIdSchema } from '../../tool-schemas.js'
import { workspacePreflight } from '../../workspace-preflight.js'
import type { McpToolContext } from '../tool-context.js'

export function registerBrowserPreflight(context: McpToolContext): void {
  const {
    auditAuthorization,
    auditReceipts,
    getPaused,
    getUserAttention,
    manager,
    registerTool,
    requireAgentWorkspace,
    tool
  } = context
  registerTool(
    'browser_preflight',
    {
      description: toolDescription('browser_preflight'),
      inputSchema: {
        workspaceId: workspaceIdSchema,
        tabId: z.uuid().optional().describe('A tab in your workspace, or omit to check its active tab.'),
        expectedOrigin: z.string().max(2048).optional().describe('Expected HTTP or HTTPS origin without credentials, path, query, or fragment.')
      }
    },
    tool(async ({ workspaceId, tabId, expectedOrigin }: { workspaceId: string; tabId?: string; expectedOrigin?: string }, extra) => {
      const unavailable = (): CallToolResult => textResult(workspacePreflight({
        authorized: false, tab: null, policy: { mode: 'unrestricted', rules: [] }, paused: false, attentionRequired: false
      }))
      try { requireAgentWorkspace(workspaceId) } catch { return unavailable() }
      const operation = async (): Promise<CallToolResult> => {
        // Audit admission can await disk I/O. Recheck ownership afterwards.
        let workspace
        try { workspace = requireAgentWorkspace(workspaceId) } catch { return unavailable() }
        const state = manager.getMcpGroupState(workspaceId)
        const selected = state.tabs.find(tab => tab.id === (tabId ?? state.activeTabId))
        const attention = getUserAttention()
        const attentionRequired = !!attention && (
          attention.workspaceId === workspaceId
          || (attention.workspaceId === undefined && attention.tabId !== undefined
            && manager.tabBelongsToMcpGroup(workspaceId, attention.tabId))
        )
        return textResult(workspacePreflight({
          authorized: true,
          tab: selected ? { url: selected.url, loading: selected.loading, sleeping: selected.sleeping } : null,
          policy: workspace.navigationPolicy,
          expectedOrigin, paused: selected ? (manager.isTabAgentPaused?.(selected.id) ?? getPaused()) : getPaused(), attentionRequired
        }))
      }
      return auditReceipts ? auditReceipts.execute(workspaceId, {
        toolName: 'browser_preflight', readOnly: true, authorization: auditAuthorization,
        observeState: () => null, signal: extra?.signal,
        operation, isErrorResult: result => result.isError === true
      }) : operation()
    })
  )
}
