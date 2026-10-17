import { z } from 'zod'
import { textResult, toolDescription } from '../../tool-results.js'
import { tabIdSchema } from '../../tool-schemas.js'
import type { McpToolContext } from '../tool-context.js'

export function registerBrowserType(context: McpToolContext): void {
  const { manager, registerWorkspaceTool, tabTool } = context
  registerWorkspaceTool(
    'browser_type',
    {
      description: toolDescription('browser_type'),
      inputSchema: {
        tabId: tabIdSchema.optional(),
        ref: z.string().optional(),
        selector: z.string().optional(),
        text: z.string(),
        submit: z.boolean().optional()
      }
    },
    tabTool('browser_type', async (input: { tabId?: string; ref?: string; selector?: string; text: string; submit?: boolean }) =>
      textResult(await manager.type(input))
    ),
    { stepTarget: input => ({ ref: input.ref }) }
  )
}
