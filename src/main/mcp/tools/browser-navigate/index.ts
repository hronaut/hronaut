import { z } from 'zod'
import { toolDescription } from '../../tool-results.js'
import { tabIdSchema } from '../../tool-schemas.js'
import type { McpToolContext, WorkspaceToolCall } from '../tool-context.js'
import { navigate } from '../../../browser/page-navigation/page-navigation.js'
import { type PageRead, pageLoadResult, pageReadInputSchema, pageReadSettlement } from '../page-load-result.js'

export function registerBrowserNavigate(context: McpToolContext): void {
  const { manager, registerWorkspaceTool, tabTool } = context
  registerWorkspaceTool(
    'browser_navigate',
    {
      description: toolDescription('browser_navigate'),
      inputSchema: { url: z.string().min(1), tabId: tabIdSchema.optional(), ...pageReadInputSchema }
    },
    tabTool('browser_navigate', async ({ url, tabId, read, maxChars }: { url: string; tabId?: string; read?: PageRead; maxChars?: number },
      call: WorkspaceToolCall<unknown>) => {
      await navigate(manager, url, tabId)
      return pageLoadResult(context, call, { read, maxChars })
    }),
    { settlement: input => pageReadSettlement(manager, input), stepTarget: input => ({ url: input.url }), publicObserverAllowed: true }
  )
}
