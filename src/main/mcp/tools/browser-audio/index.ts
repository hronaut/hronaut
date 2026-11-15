import { z } from 'zod'
import { textResult, toolDescription } from '../../tool-results.js'
import { tabIdSchema } from '../../tool-schemas.js'
import type { McpToolContext } from '../tool-context.js'
import { getTab } from '../../../browser/browser-core.js'
import { setTabMuted } from '../../../browser/tab-muting/tab-muting.js'

export function registerBrowserAudio(context: McpToolContext): void {
  const { manager, registerWorkspaceTool, tabTool } = context
  registerWorkspaceTool(
    'browser_audio',
    {
      description: toolDescription('browser_audio'),
      inputSchema: {
        tabId: tabIdSchema.optional(),
        muted: z.boolean()
      }
    },
    tabTool('browser_audio', async ({ tabId, muted }: { tabId?: string; muted: boolean }) => {
      const resolvedTabId = tabId ?? getTab(manager).id
      return textResult(setTabMuted(manager, resolvedTabId, muted))
    })
  )
}
