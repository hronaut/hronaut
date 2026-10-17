import { z } from 'zod'
import { textResult, toolDescription } from '../../tool-results.js'
import { tabIdSchema } from '../../tool-schemas.js'
import type { McpToolContext } from '../tool-context.js'

export function registerBrowserImageState(context: McpToolContext): void {
  const { frameRequests, manager, registerWorkspaceTool, tabTool } = context
  registerWorkspaceTool(
    'browser_image_state',
    {
      description: toolDescription('browser_image_state'),
      inputSchema: {
        tabId: tabIdSchema.optional(),
        ref: z.never().optional().describe('Snapshot refs are unsupported; use a unique selector. Ref input is rejected even when selector is also supplied.'),
        selector: z.string().min(1).max(1_000).describe('Select one unique current top-level light-DOM HTML image. This is current selector resolution, not historical snapshot identity.')
      }
    },
    tabTool('browser_image_state', async (options: { tabId?: string; ref?: never; selector: string; validateInspection?: () => void }) =>
      textResult(await manager.imageState(options, options.validateInspection, pending => { frameRequests.getStore()!.elementInspection = pending })))
  )
}
