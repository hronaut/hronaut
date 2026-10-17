import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import { type BrowserNetworkRequestCopyFormat, formatNetworkRequestCopy } from '../../../../shared/network-request-copy.js'
import { textResult, toolDescription } from '../../tool-results.js'
import { tabIdSchema } from '../../tool-schemas.js'
import type { McpToolContext, WorkspaceToolCall } from '../tool-context.js'

// Keeps the retained request's check until the call settles, so the detail is published only if it still holds.
function networkDetailSettlement() {
  let publication: (() => void) | undefined
  return {
    retain: (check: () => void): void => { publication = check },
    publish: (result: CallToolResult): CallToolResult | undefined => {
      if (result.isError) return undefined
      if (!publication) throw new Error('Network detail publication guard is unavailable')
      publication()
      return result // No await after validating the retained request and its authority.
    }
  }
}

export function registerBrowserNetworkRequest(context: McpToolContext): void {
  const { manager, registerWorkspaceTool, tabTool } = context
  registerWorkspaceTool(
    'browser_network_request',
    {
      description: toolDescription('browser_network_request'),
      inputSchema: {
        requestId: z.string().min(1),
        tabId: tabIdSchema.optional(),
        maxChars: z.number().int().min(1_000).max(100_000).optional(),
        copyAs: z.enum(['json', 'curl', 'powershell', 'fetch']).optional()
      }
    },
    tabTool('browser_network_request', async ({ requestId, tabId, maxChars, copyAs }: {
      requestId: string
      tabId?: string
      maxChars?: number
      copyAs?: 'json' | BrowserNetworkRequestCopyFormat
    }, call: WorkspaceToolCall<ReturnType<typeof networkDetailSettlement>>) => {
      const details = await manager.networkRequestDetails(tabId, requestId, maxChars, true, assertCurrent => {
        call.settlement.retain(() => { call.requireCurrentTarget(); assertCurrent() })
      })
      return textResult(copyAs && copyAs !== 'json' ? formatNetworkRequestCopy(details, copyAs) : details)
    }),
    { settlement: networkDetailSettlement }
  )
}
