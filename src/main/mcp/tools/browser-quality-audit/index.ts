import { textResult, toolDescription } from '../../tool-results.js'
import { tabIdSchema } from '../../tool-schemas.js'
import type { McpToolContext } from '../tool-context.js'

export function registerBrowserQualityAudit(context: McpToolContext): void {
  const { manager, registerWorkspaceTool, tabTool } = context
  registerWorkspaceTool(
    'browser_quality_audit',
    {
      description: toolDescription('browser_quality_audit'),
      inputSchema: { tabId: tabIdSchema.optional() }
    },
    tabTool('browser_quality_audit', async ({ tabId }: { tabId?: string }) =>
      textResult(await manager.qualityAudit(tabId)))
  )
}
