import { z } from 'zod'
import { agentCursorIdentity } from '../../agent-presence.js'
import { textResult, toolDescription } from '../../tool-results.js'
import { tabIdSchema } from '../../tool-schemas.js'
import type { McpToolContext } from '../tool-context.js'

export function registerBrowserDrag(context: McpToolContext): void {
  const { client, manager, registerWorkspaceTool, tabTool } = context
  registerWorkspaceTool(
    'browser_drag',
    {
      description: toolDescription('browser_drag'),
      inputSchema: {
        tabId: tabIdSchema.optional(),
        sourceRef: z.string().optional(),
        sourceSelector: z.string().optional(),
        targetRef: z.string().optional(),
        targetSelector: z.string().optional(),
        startX: z.number().finite().nonnegative().optional(),
        startY: z.number().finite().nonnegative().optional(),
        endX: z.number().finite().nonnegative().optional(),
        endY: z.number().finite().nonnegative().optional()
      }
    },
    tabTool('browser_drag', async ({ validateNativeInput, ...input }: {
      validateNativeInput?: (validateContext: () => void) => void
      tabId?: string
      sourceRef?: string
      sourceSelector?: string
      targetRef?: string
      targetSelector?: string
      startX?: number
      startY?: number
      endX?: number
      endY?: number
    }) => {
      if (!validateNativeInput) throw new Error('Native input authority is unavailable')
      return textResult(await manager.drag(input, validateNativeInput, agentCursorIdentity(client.name)))
    })
  )
}
