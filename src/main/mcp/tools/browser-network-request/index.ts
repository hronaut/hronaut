import { z } from 'zod'
import { type BrowserNetworkRequestCopyFormat, formatNetworkRequestCopy } from '../../../../shared/network-request-copy.js'
import { textResult, toolDescription } from '../../tool-results.js'
import { tabIdSchema } from '../../tool-schemas.js'
import type { McpToolContext } from '../tool-context.js'

export function registerBrowserNetworkRequest(context: McpToolContext): void {
  const { frameRequests, manager, registerWorkspaceTool, tabTool } = context
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
    tabTool('browser_network_request', async ({ requestId, tabId, maxChars, copyAs, validateInspection }: {
      requestId: string
      tabId?: string
      maxChars?: number
      copyAs?: 'json' | BrowserNetworkRequestCopyFormat
      validateInspection?: () => void
    }) => {
      const details = await manager.networkRequestDetails(tabId, requestId, maxChars, true, assertCurrent => {
        frameRequests.getStore()!.networkPublication = () => { validateInspection?.(); assertCurrent() }
      })
      return textResult(copyAs && copyAs !== 'json' ? formatNetworkRequestCopy(details, copyAs) : details)
    })
  )
}
