import { z } from 'zod'
import { textResult, toolDescription } from '../../tool-results.js'
import { tabIdSchema } from '../../tool-schemas.js'
import type { McpToolContext } from '../tool-context.js'

export function registerBrowserCpuProfile(context: McpToolContext): void {
  const { manager, registerWorkspaceTool, tabTool } = context
  registerWorkspaceTool(
    'browser_cpu_profile',
    {
      description: toolDescription('browser_cpu_profile'),
      inputSchema: {
        tabId: tabIdSchema.optional(),
        action: z.enum(['get', 'start', 'stop', 'clear']).default('get')
      }
    },
    tabTool('browser_cpu_profile', async ({
      tabId,
      action
    }: {
      tabId?: string
      action: 'get' | 'start' | 'stop' | 'clear'
    }) => textResult(await manager.cpuProfile({ tabId, action })))
  )
}
