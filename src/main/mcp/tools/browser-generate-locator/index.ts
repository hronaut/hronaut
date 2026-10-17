import { z } from 'zod'
import { textResult, toolDescription } from '../../tool-results.js'
import { tabIdSchema } from '../../tool-schemas.js'
import type { McpToolContext } from '../tool-context.js'

export function registerBrowserGenerateLocator(context: McpToolContext): void {
  const { manager, registerWorkspaceTool, tabTool } = context
  registerWorkspaceTool(
    'browser_generate_locator',
    {
      description: toolDescription('browser_generate_locator'),
      inputSchema: {
        tabId: tabIdSchema.optional(),
        ref: z.string().max(200).optional(),
        selector: z.string().max(1_000).optional()
      }
    },
    tabTool('browser_generate_locator', async (options: {
      tabId?: string
      ref?: string
      selector?: string
    }) => textResult(await manager.generatePlaywrightLocator(options)))
  )
}
