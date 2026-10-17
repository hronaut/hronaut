import { z } from 'zod'
import { textResult, toolDescription } from '../../tool-results.js'
import { tabIdSchema } from '../../tool-schemas.js'
import type { McpToolContext } from '../tool-context.js'

export function registerBrowserDomChanges(context: McpToolContext): void {
  const { manager, registerWorkspaceTool, tabTool } = context
  registerWorkspaceTool(
    'browser_dom_changes',
    {
      description: toolDescription('browser_dom_changes'),
      inputSchema: {
        tabId: tabIdSchema.optional(),
        action: z.enum(['start', 'get', 'stop', 'clear']).default('get')
      }
    },
    tabTool('browser_dom_changes', async ({
      tabId,
      action
    }: {
      tabId?: string
      action: 'start' | 'get' | 'stop' | 'clear'
    }) => textResult(await manager.domChanges(action, tabId)))
  )
}
