import { textResult, toolDescription } from '../../tool-results.js'
import { tabIdSchema } from '../../tool-schemas.js'
import type { McpToolContext } from '../tool-context.js'
import { selectAgentTabAndWait } from '../../../browser/tab-selection/tab-selection.js'

export function registerBrowserSelectTab(context: McpToolContext): void {
  const { manager, registerWorkspaceTool, tabTool } = context
  registerWorkspaceTool(
    'browser_select_tab',
    { description: toolDescription('browser_select_tab'), inputSchema: { tabId: tabIdSchema } },
    tabTool(
      'browser_select_tab',
      async ({ tabId }: { tabId: string }) => textResult(await selectAgentTabAndWait(manager, tabId)),
      'handler-owned'
    ),
    { publicObserverAllowed: true }
  )
}
