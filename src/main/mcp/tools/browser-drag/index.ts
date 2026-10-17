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
    tabTool('browser_drag', async (input: {
      tabId?: string
      sourceRef?: string
      sourceSelector?: string
      targetRef?: string
      targetSelector?: string
      startX?: number
      startY?: number
      endX?: number
      endY?: number
    }, call) => {
      // Re-checks the call before each native input event.
      const validateNativeInput = (validateContext: () => void): void => {
        try {
          if (call.signal?.aborted) throw new Error('Native input cancelled; earlier input effects are not rolled back')
          call.requireCurrentTarget()
          call.requirePostWriteContext()
          validateContext()
          if (call.authorityRejection()) throw new Error('Native input authority changed; inspect fresh state before continuing. Earlier input effects are not rolled back')
        } catch (error) {
          // Preparation or an earlier click in a double-click may
          // already have effects. Never classify this as safe replay.
          call.rememberInputPolicy(error)
          call.setInvalidatedOutcome('outcome-unknown')
          throw error
        }
      }
      return textResult(await manager.drag(input, validateNativeInput, agentCursorIdentity(client.name)))
    })
  )
}
