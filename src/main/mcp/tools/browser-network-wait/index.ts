import { z } from 'zod'
import type { BrowserNetworkWaitOptions } from '../../../../shared/types.js'
import { textResult, toolDescription } from '../../tool-results.js'
import { tabIdSchema } from '../../tool-schemas.js'
import type { McpToolContext } from '../tool-context.js'

export function registerBrowserNetworkWait(context: McpToolContext): void {
  const { manager, registerWorkspaceTool, tabTool } = context
  registerWorkspaceTool(
    'browser_network_wait',
    {
      description: toolDescription('browser_network_wait'),
      inputSchema: {
        tabId: tabIdSchema.optional(),
        urlPattern: z.string().trim().min(1).max(2_048)
          .describe('Full URL wildcard pattern such as https://api.example.com/v1/* or *://*/orders?.'),
        method: z.string().trim().min(1).max(32).optional(),
        resourceType: z.string().trim().min(1).max(64).optional()
          .describe('Chromium resource type, or fetch/xhr to match either fetch or XHR.'),
        status: z.number().int().min(100).max(599).optional(),
        phase: z.enum(['request', 'response', 'complete']).default('response')
          .describe('request waits for dispatch, response waits for headers or failure, and complete waits for the body transfer or failure to finish.'),
        from: z.enum(['retained-or-future', 'future']).default('retained-or-future')
          .describe('Search already retained matches first, or arm only for events after this call.'),
        afterRequestId: z.string().min(1).optional()
          .describe('Only match requests captured after this retained Hronaut request ID. Cannot be combined with from: future.'),
        timeoutMs: z.number().int().min(1).max(60_000).default(30_000)
      }
    },
    tabTool('browser_network_wait', async (options: BrowserNetworkWaitOptions) =>
      textResult(await manager.waitForNetworkRequest(options)))
  )
}
