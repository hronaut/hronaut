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
    tabTool('browser_press', async ({ key, tabId, validateNativeInput }: { key: string; tabId?: string; validateNativeInput?: (validateContext: () => void) => void }) => {
      if (!validateNativeInput) throw new Error('Native input authority is unavailable')
      await manager.press(key, tabId, validateNativeInput)
      return textResult(`Pressed ${key}`)
    })
  )
}
