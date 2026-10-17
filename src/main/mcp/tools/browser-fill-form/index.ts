import { z } from 'zod'
import { textResult, toolDescription } from '../../tool-results.js'
import { tabIdSchema } from '../../tool-schemas.js'
import type { McpToolContext } from '../tool-context.js'

export function registerBrowserFillForm(context: McpToolContext): void {
  const { manager, registerWorkspaceTool, tabTool } = context
  registerWorkspaceTool(
    'browser_fill_form',
    {
      description: toolDescription('browser_fill_form'),
      inputSchema: {
        tabId: tabIdSchema.optional(),
        fields: z.array(z.object({
          ref: z.string().optional(),
          selector: z.string().optional(),
          value: z.union([z.string(), z.boolean()])
        })).min(1).max(50)
      }
    },
    tabTool('browser_fill_form', async ({ tabId, fields }: {
      tabId?: string
      fields: Array<{ ref?: string; selector?: string; value: string | boolean }>
    }) => textResult(await manager.fillForm(tabId, fields)))
  )
}
