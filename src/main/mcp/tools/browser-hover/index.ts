import { z } from 'zod'
import { agentCursorIdentity } from '../../agent-presence.js'
import { textResult, toolDescription } from '../../tool-results.js'
import { tabIdSchema } from '../../tool-schemas.js'
import type { McpToolContext } from '../tool-context.js'

export function registerBrowserHover(context: McpToolContext): void {
  const { client, manager, registerWorkspaceTool, tabTool } = context
  registerWorkspaceTool(
    'browser_hover',
    {
      description: toolDescription('browser_hover'),
      inputSchema: {
        tabId: tabIdSchema.optional(),
        ref: z.string().optional(),
        selector: z.string().optional(),
        x: z.number().finite().nonnegative().optional(),
        y: z.number().finite().nonnegative().optional()
      }
    },
    tabTool('browser_hover', async ({ validateNativeInput, ...input }: {
      validateNativeInput?: (validateContext: () => void) => void
      tabId?: string
      ref?: string
      selector?: string
      x?: number
      y?: number
    }) => {
      if (!validateNativeInput) throw new Error('Native input authority is unavailable')
      return textResult(await manager.hover(input, validateNativeInput, agentCursorIdentity(client.name)))
    })
  )
}
