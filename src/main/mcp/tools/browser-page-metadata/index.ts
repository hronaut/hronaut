import { textResult, toolDescription } from '../../tool-results.js'
import { tabIdSchema } from '../../tool-schemas.js'
import type { McpToolContext } from '../tool-context.js'

export function registerBrowserPageMetadata(context: McpToolContext): void {
  const { manager, registerWorkspaceTool, tabTool } = context
  registerWorkspaceTool(
    'browser_page_metadata',
    {
      description: toolDescription('browser_page_metadata'),
      inputSchema: { tabId: tabIdSchema.optional() }
    },
    tabTool('browser_page_metadata', async ({ tabId }: { tabId?: string }) =>
      textResult(await manager.pageMetadata(tabId)))
  )
}
