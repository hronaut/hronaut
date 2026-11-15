import { z } from 'zod'
import { textResult, toolDescription } from '../../tool-results.js'
import { tabIdSchema } from '../../tool-schemas.js'
import type { McpToolContext } from '../tool-context.js'
import { back, forward, reload, reloadIgnoringCache, stop } from '../../../browser/page-navigation/page-navigation.js'

export function registerBrowserHistory(context: McpToolContext): void {
  const { manager, registerWorkspaceTool, tabTool } = context
  registerWorkspaceTool(
    'browser_history',
    {
      description: toolDescription('browser_history'),
      inputSchema: {
        action: z.enum(['back', 'forward', 'reload', 'reload-ignoring-cache', 'stop']),
        tabId: tabIdSchema.optional()
      }
    },
    tabTool('browser_history', async ({ action, tabId }: { action: 'back' | 'forward' | 'reload' | 'reload-ignoring-cache' | 'stop'; tabId?: string }) => {
      if (action === 'back') return textResult(await back(manager, tabId))
      if (action === 'forward') return textResult(await forward(manager, tabId))
      if (action === 'reload') return textResult(await reload(manager, tabId))
      if (action === 'reload-ignoring-cache') return textResult(await reloadIgnoringCache(manager, tabId))
      return textResult(stop(manager, tabId))
    })
  )
}
