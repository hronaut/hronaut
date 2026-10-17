import { type NativeWheelInput, nativeWheelFields } from '../../../browser/native-wheel.js'
import { textResult, toolDescription } from '../../tool-results.js'
import { tabIdSchema } from '../../tool-schemas.js'
import type { McpToolContext } from '../tool-context.js'

export function registerBrowserWheel(context: McpToolContext): void {
  const { manager, registerWorkspaceTool, tabTool } = context
  registerWorkspaceTool(
    'browser_wheel',
    {
      description: toolDescription('browser_wheel'),
      inputSchema: { tabId: tabIdSchema, ...nativeWheelFields }
    },
    tabTool('browser_wheel', async ({ validateNativeInput, markWheelAttempted, tabId, x, y, deltaX, deltaY }: NativeWheelInput & {
      validateNativeInput?: (validateContext: () => void) => void
      markWheelAttempted?: () => void
    }) => {
      if (!validateNativeInput) throw new Error('Native input authority is unavailable')
      if (!markWheelAttempted) throw new Error('Wheel dispatch provenance is unavailable')
      return textResult(await manager.wheel({ tabId, x, y, deltaX, deltaY }, validateNativeInput, markWheelAttempted))
    }, 'never')
  )
}
