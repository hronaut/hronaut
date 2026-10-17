import { z } from 'zod'
import type { PwaLifecycleOptions } from '../../../../shared/pwa-lifecycle.js'
import { textResult, toolDescription } from '../../tool-results.js'
import { tabIdSchema } from '../../tool-schemas.js'
import type { McpToolContext } from '../tool-context.js'

export function registerBrowserPwaLifecycle(context: McpToolContext): void {
  const { manager, registerWorkspaceTool, tabTool } = context
  registerWorkspaceTool(
    'browser_pwa_lifecycle',
    {
      description: toolDescription('browser_pwa_lifecycle'),
      inputSchema: {
        tabId: tabIdSchema.optional(),
        captureId: z.string().uuid().optional().describe('Read retained evidence from a previous capture in this workspace, including a closed tab.'),
        action: z.enum(['start', 'get', 'stop', 'clear']).default('get')
      }
    },
    tabTool('browser_pwa_lifecycle', async (options: PwaLifecycleOptions, call) =>
      textResult(await manager.pwaLifecycle(options, call.validateLifecycle)), 'never')
  )
}
