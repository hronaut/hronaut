import { z } from 'zod'
import { textResult, toolDescription } from '../../tool-results.js'
import { tabIdSchema } from '../../tool-schemas.js'
import type { McpToolContext } from '../tool-context.js'

export function registerBrowserIssues(context: McpToolContext): void {
  const { manager, registerWorkspaceTool, tabTool } = context
  registerWorkspaceTool(
    'browser_issues',
    {
      description: toolDescription('browser_issues'),
      inputSchema: {
        tabId: tabIdSchema.optional(),
        action: z.enum(['list', 'clear']).default('list')
      }
    },
    tabTool('browser_issues', async ({ tabId, action }: { tabId?: string; action: 'list' | 'clear' }) =>
      textResult(await manager.inspectorIssues(tabId, action === 'clear')))
  )
}
