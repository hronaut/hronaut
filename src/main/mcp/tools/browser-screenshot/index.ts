import { z } from 'zod'
import { toolDescription } from '../../tool-results.js'
import { tabIdSchema } from '../../tool-schemas.js'
import { pageObservationSettlement, type PageObservationSettlement } from '../page-observation-settlement.js'
import type { McpToolContext, WorkspaceToolCall } from '../tool-context.js'

export function registerBrowserScreenshot(context: McpToolContext): void {
  const { manager, registerWorkspaceTool, tabTool } = context
  registerWorkspaceTool(
    'browser_screenshot',
    {
      description: toolDescription('browser_screenshot'),
      inputSchema: {
        tabId: tabIdSchema.optional(),
        annotateRefs: z.array(z.string().regex(/^e[1-9]\d{0,5}$/)).min(1).max(50).optional(),
        fullPage: z.boolean().optional(),
        ref: z.string().optional(),
        selector: z.string().optional(),
        clip: z.object({
          x: z.number().int().min(0).max(7680),
          y: z.number().int().min(0).max(7680),
          width: z.number().int().min(1).max(7680),
          height: z.number().int().min(1).max(7680)
        }).optional(),
        format: z.enum(['png', 'jpeg']).optional(),
        quality: z.number().int().min(1).max(100).optional(),
        maxWidth: z.number().int().min(64).max(7680).optional(),
        maxHeight: z.number().int().min(64).max(7680).optional()
      }
    },
    tabTool('browser_screenshot', async (options: {
      annotateRefs?: string[]
      tabId?: string
      fullPage?: boolean
      ref?: string
      selector?: string
      clip?: { x: number; y: number; width: number; height: number }
      format?: 'png' | 'jpeg'
      quality?: number
      maxWidth?: number
      maxHeight?: number
    }, _call: WorkspaceToolCall<PageObservationSettlement>) => {
      const previewBefore = manager.cssStatePreviewMarker(options.tabId)
      const image = await manager.screenshot(options)
      const cssStatePreview = previewBefore ?? manager.cssStatePreviewMarker(options.tabId)
      return { content: [
        ...(image.annotations ? [{ type: 'text' as const, text: JSON.stringify(image.annotations) }] : []),
        ...(cssStatePreview ? [{ type: 'text' as const, text: JSON.stringify({ cssStatePreview, note: 'Captured while a forced CSS state was applied; this is not natural page state.' }) }] : []),
        { type: 'image' as const, data: image.data.toString('base64'), mimeType: image.mimeType }
      ] }
    }),
    { settlement: () => pageObservationSettlement(manager), continuityInspection: () => true }
  )
}
