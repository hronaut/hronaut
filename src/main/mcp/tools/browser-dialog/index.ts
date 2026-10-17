import { z } from 'zod'
import { textResult, toolDescription } from '../../tool-results.js'
import { tabIdSchema } from '../../tool-schemas.js'
import type { McpToolContext } from '../tool-context.js'

export function registerBrowserDialog(context: McpToolContext): void {
  const { manager, registerWorkspaceTool, tabTool } = context
  registerWorkspaceTool(
    'browser_dialog',
    {
      description: toolDescription('browser_dialog'),
      inputSchema: {
        action: z.enum(['accept', 'dismiss']),
        tabId: tabIdSchema.optional()
      }
    },
    tabTool('browser_dialog', async ({ action, tabId }: {
      action: 'accept' | 'dismiss'
      tabId?: string
    }) => textResult(await manager.handleDialog(action, tabId)))
  )
}
