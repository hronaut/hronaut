import { z } from 'zod'
import { textResult, toolDescription } from '../../tool-results.js'
import { tabIdSchema } from '../../tool-schemas.js'
import type { McpToolContext } from '../tool-context.js'
import { readZoom, setZoom } from '../../../browser/page-zoom/page-zoom.js'

export function registerBrowserZoom(context: McpToolContext): void {
  const { manager, registerWorkspaceTool, tabTool } = context
  registerWorkspaceTool(
    'browser_zoom',
    {
      description: toolDescription('browser_zoom'),
      inputSchema: {
        tabId: tabIdSchema.optional(),
        // Reading is the default, so a call that names no action never changes the zoom of the person's site.
        action: z.enum(['get', 'in', 'out', 'reset', 'set']).default('get'),
        percent: z.number().int().min(50).max(400).optional()
      }
    },
    tabTool('browser_zoom', async ({ tabId, action, percent }: {
      tabId?: string
      action: 'get' | 'in' | 'out' | 'reset' | 'set'
      percent?: number
    }) => textResult(action === 'get' ? readZoom(manager, tabId) : setZoom(manager, { tabId, action, percent })))
  )
}
