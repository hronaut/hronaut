import { type NativeKeyHoldInput, type NativeKeyHoldProgress, nativeKeyHoldFields } from '../../../browser/native-key-hold.js'
import { textResult, toolDescription } from '../../tool-results.js'
import { tabIdSchema } from '../../tool-schemas.js'
import type { McpToolContext } from '../tool-context.js'

export function registerBrowserHoldKey(context: McpToolContext): void {
  const { manager, registerWorkspaceTool, tabTool } = context
  registerWorkspaceTool(
    'browser_hold_key',
    { description: toolDescription('browser_hold_key'), inputSchema: { tabId: tabIdSchema, ...nativeKeyHoldFields } },
    tabTool('browser_hold_key', async ({ tabId, key, durationMs, validateNativeInput, recordHoldProgress, holdSignal }: NativeKeyHoldInput & {
      validateNativeInput?: (validateContext: () => void) => void
      recordHoldProgress?: (progress: NativeKeyHoldProgress) => void
      holdSignal?: AbortSignal
    }) => {
      if (!validateNativeInput || !recordHoldProgress) throw new Error('Key hold authority or provenance is unavailable')
      return textResult(await manager.holdKey({ tabId, key, durationMs }, validateNativeInput, recordHoldProgress, holdSignal))
    }, 'never')
  )
}
