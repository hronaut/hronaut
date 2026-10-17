import { z } from 'zod'
import { MAX_BROWSER_KEY_PRESS_LENGTH } from '../../../../shared/keyboard-input.js'
import { textResult, toolDescription } from '../../tool-results.js'
import { tabIdSchema } from '../../tool-schemas.js'
import type { McpToolContext } from '../tool-context.js'

export function registerBrowserPress(context: McpToolContext): void {
  const { manager, registerWorkspaceTool, tabTool } = context
  registerWorkspaceTool(
    'browser_press',
    {
      description: toolDescription('browser_press'),
      inputSchema: {
        key: z.string().min(1).max(MAX_BROWSER_KEY_PRESS_LENGTH)
          .describe('Key or combination such as Enter, ArrowLeft, x, Control+A, or Control+Shift+R.'),
        tabId: tabIdSchema.optional()
      }
    },
    tabTool('browser_press', async ({ key, tabId }: { key: string; tabId?: string }, call) => {
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
      await manager.press(key, tabId, validateNativeInput)
      return textResult(`Pressed ${key}`)
    })
  )
}
