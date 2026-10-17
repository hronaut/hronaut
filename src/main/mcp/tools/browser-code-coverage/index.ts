import { z } from 'zod'
import { textResult, toolDescription } from '../../tool-results.js'
import { tabIdSchema } from '../../tool-schemas.js'
import type { McpToolContext } from '../tool-context.js'

export function registerBrowserCodeCoverage(context: McpToolContext): void {
  const { manager, registerWorkspaceTool, tabTool } = context
  registerWorkspaceTool(
    'browser_code_coverage',
    {
      description: toolDescription('browser_code_coverage'),
      inputSchema: {
        tabId: tabIdSchema.optional(),
        action: z.enum(['get', 'start', 'stop', 'clear']).default('get'),
        mode: z.enum(['function', 'block']).default('function'),
        reload: z.boolean().default(true)
      }
    },
    tabTool('browser_code_coverage', async ({
      tabId,
      action,
      mode,
      reload
    }: {
      tabId?: string
      action: 'get' | 'start' | 'stop' | 'clear'
      mode: 'function' | 'block'
      reload: boolean
    }) => textResult(await manager.codeCoverage({ tabId, action, mode, reload })))
  )
}
