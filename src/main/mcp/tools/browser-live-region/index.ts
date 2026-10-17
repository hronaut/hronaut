import { z } from 'zod'
import { LIVE_REGION_LIMITS } from '../../../../shared/live-region.js'
import { textResult, toolDescription } from '../../tool-results.js'
import { tabIdSchema } from '../../tool-schemas.js'
import type { McpToolContext } from '../tool-context.js'

export function registerBrowserLiveRegion(context: McpToolContext): void {
  const { manager, registerWorkspaceTool, tabTool } = context
  registerWorkspaceTool(
    'browser_live_region',
    {
      description: toolDescription('browser_live_region'),
      inputSchema: {
        tabId: tabIdSchema.optional(),
        action: z.enum(['start', 'get', 'stop', 'clear']).default('get'),
        selector: z.string().min(1).max(LIVE_REGION_LIMITS.maxSelectorChars).optional()
          .describe('CSS selector for exactly one top-level light-DOM region; required for start')
      }
    },
    tabTool('browser_live_region', async ({
      tabId,
      action,
      selector
    }: {
      tabId?: string
      action: 'start' | 'get' | 'stop' | 'clear'
      selector?: string
    }) => textResult(await manager.liveRegion(action, tabId, selector)))
  )
}
