import { z } from 'zod'
import { type NativeKeySequenceInput, nativeKeySequenceFields, playKeySequence } from '../../../browser/agent-keys/key-sequence.js'
import { textResult, toolDescription } from '../../tool-results.js'
import { tabIdSchema } from '../../tool-schemas.js'
import type { McpToolContext, WorkspaceToolCall } from '../tool-context.js'
// A sequence settles as a key hold does: nothing was sent before its first down, and after it any failure is unknown.
import { type KeyHoldSettlement, keyHoldSettlement } from '../browser-hold-key/key-hold-settlement.js'

export function registerBrowserKeySequence(context: McpToolContext): void {
  const { manager, registerWorkspaceTool, tabTool } = context
  registerWorkspaceTool(
    'browser_key_sequence',
    { description: toolDescription('browser_key_sequence'), inputSchema: { tabId: tabIdSchema, ...nativeKeySequenceFields } },
    tabTool('browser_key_sequence', async ({ tabId, events }: NativeKeySequenceInput, call: WorkspaceToolCall<KeyHoldSettlement>) => {
      // Re-checks the call before each native input event, also while the sequence waits between them.
      const validateNativeInput = (validateContext: () => void): void => {
        try {
          if (call.signal?.aborted) throw new Error('Native input cancelled; earlier input effects are not rolled back')
          call.requireCurrentTarget()
          call.requirePostWriteContext()
          validateContext()
          if (call.authorityRejection()) {
            throw new Error('Native input authority changed; inspect fresh state before continuing. Earlier input effects are not rolled back')
          }
        } catch (error) {
          call.rememberInputPolicy(error)
          call.setInvalidatedOutcome(call.settlement.progress()?.downAttempted ? 'outcome-unknown' : undefined)
          throw error
        }
      }
      return textResult(await playKeySequence(manager, { tabId, events }, validateNativeInput, call.settlement.recordProgress, call.signal))
    }, 'never'),
    { settlement: () => keyHoldSettlement(), preservesPresentation: () => true, inputSchema: shape => z.object(shape).strict() }
  )
}
