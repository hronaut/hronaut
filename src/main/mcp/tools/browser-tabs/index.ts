import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import { TAB_DISCOVERY_LIMITS, type TabDiscoverySearch, compactTabDiscovery } from '../../tab-discovery.js'
import { mcpWorkspaceTab, textResult, toolDescription } from '../../tool-results.js'
import type { McpToolContext, ToolCallSettlement } from '../tool-context.js'

// A search result is published only if the workspace, control and capability still hold when the call settles.
function tabDiscoverySettlement() {
  let publication: (() => void) | undefined
  return {
    prepare: call => {
      publication = () => {
        if (call.signal?.aborted) throw new Error('Tab discovery cancelled')
        call.requireCurrentTarget()
      }
    },
    publish: (result: CallToolResult): CallToolResult | undefined => {
      if (result.isError) return undefined
      if (!publication) throw new Error('Tab discovery publication guard is unavailable')
      publication()
      return result // No await after final workspace/control/capability checks.
    }
  } satisfies ToolCallSettlement
}

export function registerBrowserTabs(context: McpToolContext): void {
  const { manager, registerWorkspaceTool, tool } = context
  registerWorkspaceTool(
    'browser_tabs',
    { description: toolDescription('browser_tabs'), inputSchema: {
      search: z.object({
        query: z.string().max(TAB_DISCOVERY_LIMITS.queryChars).optional().describe('Literal, case-insensitive whitespace-separated terms; each term must match the same tab’s projected title or address. An empty query lists eligible tabs.'),
        limit: z.number().int().min(1).max(TAB_DISCOVERY_LIMITS.results).optional().describe('Maximum compact results; defaults to 10. Output may stop earlier at its character bound.')
      }).strict().optional().describe('Opt in to compact discovery of live HTTP(S) tabs. Addresses omit credentials, fragments and recognized secret query values. Only current-document titles confirmed by explicit native title events are included; unverified and URL fallback titles are empty. Title/address projections are bounded; counts cover projected fields only. Omit search to keep the existing full tab-state response.')
    } },
    tool(async ({ workspaceId, search }: { workspaceId?: string; search?: TabDiscoverySearch }) => {
      return textResult(search === undefined
        ? manager.getMcpGroupState(workspaceId!).tabs.map(mcpWorkspaceTab)
        : compactTabDiscovery(manager.getMcpDiscoveryTabs(workspaceId!), search))
    }),
    {
      settlement: input => input.search !== undefined ? tabDiscoverySettlement() : undefined,
      tabTarget: 'none',
      continuityInspection: () => true,
      pageOrigins: 'all-tabs'
    }
  )
}
