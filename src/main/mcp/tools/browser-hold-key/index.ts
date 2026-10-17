import { type NativeKeyHoldInput, type NativeKeyHoldProgress, nativeKeyHoldFields } from '../../../browser/native-key-hold.js'
import { textResult, toolDescription } from '../../tool-results.js'
import { tabIdSchema } from '../../tool-schemas.js'
import type { McpToolContext } from '../tool-context.js'

export function registerBrowserHoldKey(context: McpToolContext): void {
  const { frameRequests, manager, registerWorkspaceTool, tabTool } = context
  registerWorkspaceTool(
    'browser_hold_key',
    { description: toolDescription('browser_hold_key'), inputSchema: { tabId: tabIdSchema, ...nativeKeyHoldFields } },
    tabTool('browser_hold_key', async ({ tabId, key, durationMs }: NativeKeyHoldInput, call) => {
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
          call.setInvalidatedOutcome(frameRequests.getStore()?.keyHoldProgress?.downAttempted ? 'outcome-unknown' : undefined)
          throw error
        }
      }
      const recordHoldProgress = (progress: NativeKeyHoldProgress): void => { frameRequests.getStore()!.keyHoldProgress = { ...progress } }
      return textResult(await manager.holdKey({ tabId, key, durationMs }, validateNativeInput, recordHoldProgress, call.signal))
    }, 'never'),
    { preservesPresentation: () => true }
  )
}
