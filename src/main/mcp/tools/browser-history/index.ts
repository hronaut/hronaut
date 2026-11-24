import { z } from 'zod'
import { toolDescription } from '../../tool-results.js'
import { tabIdSchema } from '../../tool-schemas.js'
import type { McpToolContext, WorkspaceToolCall } from '../tool-context.js'
import { back, forward, reload, reloadIgnoringCache, stop } from '../../../browser/page-navigation/page-navigation.js'
import { type PageRead, pageLoadResult, pageReadInputSchema, pageReadSettlement } from '../page-load-result.js'

type HistoryAction = 'back' | 'forward' | 'reload' | 'reload-ignoring-cache' | 'stop'

export function registerBrowserHistory(context: McpToolContext): void {
  const { manager, registerWorkspaceTool, tabTool } = context
  registerWorkspaceTool(
    'browser_history',
    {
      description: toolDescription('browser_history'),
      inputSchema: {
        action: z.enum(['back', 'forward', 'reload', 'reload-ignoring-cache', 'stop']),
        tabId: tabIdSchema.optional(),
        ...pageReadInputSchema
      }
    },
    tabTool('browser_history', async ({ action, tabId, read, maxChars }: { action: HistoryAction; tabId?: string; read?: PageRead; maxChars?: number },
      call: WorkspaceToolCall<unknown>) => {
      if (action === 'back') await back(manager, tabId)
      else if (action === 'forward') await forward(manager, tabId)
      else if (action === 'reload') await reload(manager, tabId)
      else if (action === 'reload-ignoring-cache') await reloadIgnoringCache(manager, tabId)
      else stop(manager, tabId)
      return pageLoadResult(context, call, { read, maxChars })
    }),
    { settlement: input => pageReadSettlement(manager, input) }
  )
}
