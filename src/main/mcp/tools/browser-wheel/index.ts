import { type NativeWheelInput, nativeWheelFields } from '../../../browser/native-wheel.js'
import { textResult, toolDescription } from '../../tool-results.js'
import { tabIdSchema } from '../../tool-schemas.js'
import type { McpToolContext, WorkspaceToolCall } from '../tool-context.js'
import { type WheelSettlement, wheelSettlement } from './wheel-settlement.js'

export function registerBrowserWheel(context: McpToolContext): void {
  const { manager, registerWorkspaceTool, tabTool } = context
  registerWorkspaceTool(
    'browser_wheel',
    {
      description: toolDescription('browser_wheel'),
      inputSchema: { tabId: tabIdSchema, ...nativeWheelFields }
    },
    tabTool('browser_wheel', async ({ tabId, x, y, deltaX, deltaY }: NativeWheelInput, call: WorkspaceToolCall<WheelSettlement>) => {
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
      return textResult(await manager.wheel({ tabId, x, y, deltaX, deltaY }, validateNativeInput, call.settlement.markAttempted))
    }, 'never'),
    { settlement: () => wheelSettlement(), preservesPresentation: () => true }
  )
}
