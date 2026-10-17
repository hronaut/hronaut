import { z } from 'zod'
import { textResult, toolDescription } from '../../tool-results.js'
import { tabIdSchema } from '../../tool-schemas.js'
import type { McpToolContext } from '../tool-context.js'

export function registerBrowserConsole(context: McpToolContext): void {
  const { manager, registerWorkspaceTool, tabTool } = context
  registerWorkspaceTool(
    'browser_console',
    {
      description: toolDescription('browser_console'),
      inputSchema: {
        tabId: tabIdSchema.optional(),
        level: z.enum(['debug', 'info', 'warning', 'error']).optional(),
        clear: z.boolean().optional()
      }
    },
    tabTool('browser_console', async ({ tabId, level, clear }: { tabId?: string; level?: string; clear?: boolean }) => {
      const messages = manager.consoleMessages(tabId, clear)
      return textResult(level ? messages.filter((message) => message.level === level) : messages)
    })
  )
}
