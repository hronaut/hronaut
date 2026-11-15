import { textResult, toolDescription } from '../../tool-results.js'
import { tabIdSchema } from '../../tool-schemas.js'
import type { McpToolContext } from '../tool-context.js'
import { designOverview } from '../../../browser/page-audits/design-overview.js'

export function registerBrowserDesignOverview(context: McpToolContext): void {
  const { manager, registerWorkspaceTool, tabTool } = context
  registerWorkspaceTool(
    'browser_design_overview',
    {
      description: toolDescription('browser_design_overview'),
      inputSchema: { tabId: tabIdSchema.optional() }
    },
    tabTool('browser_design_overview', async ({ tabId }: { tabId?: string }) =>
      textResult(await designOverview(manager, tabId)))
  )
}
