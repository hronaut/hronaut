import { z } from 'zod'
import { textResult, toolDescription } from '../../tool-results.js'
import { tabIdSchema } from '../../tool-schemas.js'
import type { McpToolContext } from '../tool-context.js'

export function registerBrowserNavigate(context: McpToolContext): void {
  const { manager, registerWorkspaceTool, tabTool } = context
  registerWorkspaceTool(
    'browser_navigate',
    {
      description: toolDescription('browser_navigate'),
      inputSchema: { url: z.string().min(1), tabId: tabIdSchema.optional() }
    },
    tabTool('browser_navigate', async ({ url, tabId }: { url: string; tabId?: string }) => textResult(await manager.navigate(url, tabId))),
    { stepTarget: input => ({ url: input.url }), publicObserverAllowed: true }
  )
}
