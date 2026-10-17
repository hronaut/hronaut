import { z } from 'zod'
import { type NativeKeyHoldInput, nativeKeyHoldFields } from '../../../browser/native-key-hold.js'
import { textResult, toolDescription } from '../../tool-results.js'
import { tabIdSchema } from '../../tool-schemas.js'
import type { McpToolContext, WorkspaceToolCall } from '../tool-context.js'
import { type KeyHoldSettlement, keyHoldSettlement } from './key-hold-settlement.js'

export function registerBrowserHoldKey(context: McpToolContext): void {
  const { manager, registerWorkspaceTool, tabTool } = context
  registerWorkspaceTool(
    'browser_hold_key',
    { description: toolDescription('browser_hold_key'), inputSchema: { tabId: tabIdSchema, ...nativeKeyHoldFields } },
    tabTool('browser_hold_key', async ({ tabId, key, durationMs }: NativeKeyHoldInput, call: WorkspaceToolCall<KeyHoldSettlement>) => {
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
          call.setInvalidatedOutcome(call.settlement.progress()?.downAttempted ? 'outcome-unknown' : undefined)
          throw error
        }
      }
      return textResult(await manager.holdKey({ tabId, key, durationMs }, validateNativeInput, call.settlement.recordProgress, call.signal))
    }, 'never'),
    { settlement: () => keyHoldSettlement(), preservesPresentation: () => true, inputSchema: shape => z.object(shape).strict() }
  )
}
