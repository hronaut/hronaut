import { z } from 'zod'
import { textResult, toolDescription } from '../../tool-results.js'
import { tabIdSchema } from '../../tool-schemas.js'
import type { McpToolContext } from '../tool-context.js'

export function registerBrowserNetworkReplay(context: McpToolContext): void {
  const { manager, registerWorkspaceTool, tabTool } = context
  registerWorkspaceTool(
    'browser_network_replay',
    {
      description: toolDescription('browser_network_replay'),
      inputSchema: {
        requestId: z.string().min(1).describe('Current Hronaut request ID returned by browser_network.'),
        tabId: tabIdSchema.optional(),
        confirmSideEffects: z.boolean().default(false).describe('Required for every method except GET and HEAD. Set true only after reviewing the request and accepting that replay can repeat writes or other side effects.')
      }
    },
    tabTool('browser_network_replay', async ({ requestId, tabId, confirmSideEffects }: {
      requestId: string
      tabId?: string
      confirmSideEffects?: boolean
    }) => textResult(await manager.replayNetworkRequest(tabId, requestId, confirmSideEffects === true)))
  )
}
