import { textResult, toolDescription } from '../../tool-results.js'
import { tabIdSchema } from '../../tool-schemas.js'
import type { McpToolContext } from '../tool-context.js'
import { securityReport } from '../../../browser/page-audits/security-report.js'

export function registerBrowserSecurity(context: McpToolContext): void {
  const { manager, registerWorkspaceTool, tabTool } = context
  registerWorkspaceTool(
    'browser_security',
    {
      description: toolDescription('browser_security'),
      inputSchema: { tabId: tabIdSchema.optional() }
    },
    tabTool('browser_security', async ({ tabId }: { tabId?: string }) =>
      textResult(securityReport(manager, tabId)))
  )
}
