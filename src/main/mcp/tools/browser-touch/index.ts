import { z } from 'zod'
import { type NativeTouchInput, nativeTouchFields, refineNativeTouch } from '../../../browser/agent-touch/agent-touch.js'
import { textResult, toolDescription } from '../../tool-results.js'
import { tabIdSchema } from '../../tool-schemas.js'
import type { McpToolContext, WorkspaceToolCall } from '../tool-context.js'
import { type TouchSettlement, touchSettlement } from './touch-settlement.js'

export function registerBrowserTouch(context: McpToolContext): void {
  const { manager, registerWorkspaceTool, tabTool } = context
  registerWorkspaceTool(
    'browser_touch',
    {
      description: toolDescription('browser_touch'),
      inputSchema: { tabId: tabIdSchema, ...nativeTouchFields }
    },
    tabTool('browser_touch', async ({ tabId, gesture, x, y, endX, endY, durationMs }: NativeTouchInput, call: WorkspaceToolCall<TouchSettlement>) => {
      // Re-checks the call before each touch event and while a swipe waits between moves.
      const validateNativeInput = (validateContext: () => void): void => {
        try {
          if (call.signal?.aborted) throw new Error('Native input cancelled; earlier input effects are not rolled back')
          call.requireCurrentTarget()
          call.requirePostWriteContext()
          validateContext()
          if (call.authorityRejection()) throw new Error('Native input authority changed; inspect fresh state before continuing. Earlier input effects are not rolled back')
        } catch (error) {
          call.rememberInputPolicy(error)
          call.setInvalidatedOutcome(call.settlement.progress()?.startAttempted ? 'outcome-unknown' : undefined)
          throw error
        }
      }
      const input = { tabId, gesture, x, y, ...(endX === undefined ? {} : { endX }), ...(endY === undefined ? {} : { endY }),
        ...(durationMs === undefined ? {} : { durationMs }) }
      return textResult(await manager.touch(input, validateNativeInput, call.settlement.recordProgress, call.signal))
    }, 'never'),
    {
      settlement: () => touchSettlement(),
      preservesPresentation: () => true,
      // The registered shape also carries the workspace fields, so the parsed value is narrowed for the touch rules.
      inputSchema: shape => z.object(shape).strict().superRefine((value, refinement) => refineNativeTouch(value as Parameters<typeof refineNativeTouch>[0], refinement))
    }
  )
}
