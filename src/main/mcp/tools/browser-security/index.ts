import { textResult, toolDescription } from '../../tool-results.js'
import { tabIdSchema } from '../../tool-schemas.js'
import type { McpToolContext } from '../tool-context.js'

export function registerBrowserSecurity(context: McpToolContext): void {
  const { manager, registerWorkspaceTool, tabTool } = context
  registerWorkspaceTool(
    'browser_security',
    {
      description: toolDescription('browser_security'),
      inputSchema: { tabId: tabIdSchema.optional() }
    },
    tabTool('browser_security', async ({ tabId }: { tabId?: string }) =>
      textResult(manager.securityReport(tabId)))
  )
}
