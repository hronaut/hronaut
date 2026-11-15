import { z } from 'zod'
import { textResult, toolDescription } from '../../tool-results.js'
import { tabIdSchema } from '../../tool-schemas.js'
import type { McpToolContext } from '../tool-context.js'
import { controlPageLifecycle, pageLifecycle } from '../../../browser/page-lifecycle/page-lifecycle.js'

export function registerBrowserPageLifecycle(context: McpToolContext): void {
  const { manager, registerWorkspaceTool, tabTool } = context
  registerWorkspaceTool(
    'browser_page_lifecycle',
    {
      description: toolDescription('browser_page_lifecycle'),
      inputSchema: {
        tabId: tabIdSchema.optional(),
        action: z.enum(['status', 'freeze', 'resume']).default('status')
          .describe('Status is read-only. Freeze and resume are explicit per-tab operations; an ambiguous dispatched outcome is never replayed automatically.')
      }
    },
    tabTool('browser_page_lifecycle', async ({ tabId, action }: {
      tabId?: string
      action: 'status' | 'freeze' | 'resume'
    }) => textResult(action === 'status'
      ? pageLifecycle(manager, tabId!)
      : await controlPageLifecycle(manager, tabId!, action === 'freeze' ? 'frozen' : 'active')), 'never')
  )
}
