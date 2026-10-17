import { textResult, toolDescription } from '../../tool-results.js'
import { tabIdSchema } from '../../tool-schemas.js'
import type { McpToolContext } from '../tool-context.js'

export function registerBrowserCloseTab(context: McpToolContext): void {
  const { manager, registerWorkspaceTool, tool, withResolvedTargetWakePolicy } = context
  registerWorkspaceTool(
    'browser_close_tab',
    { description: toolDescription('browser_close_tab'), inputSchema: { tabId: tabIdSchema } },
    withResolvedTargetWakePolicy(
      tool(async ({ tabId }: { tabId: string }) => textResult(await manager.closeTab(tabId))),
      'never'
    ),
    { closesTargetTab: true, publicObserverAllowed: true }
  )
}
