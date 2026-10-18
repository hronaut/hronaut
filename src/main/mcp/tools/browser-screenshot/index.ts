import { z } from 'zod'
import { toolDescription } from '../../tool-results.js'
import { tabIdSchema } from '../../tool-schemas.js'
import { pageObservationSettlement, type PageObservationSettlement } from '../page-observation-settlement.js'
import type { McpToolContext, WorkspaceToolCall } from '../tool-context.js'
import { ScreenshotObservations } from './screenshot-observations.js'

export function registerBrowserScreenshot(context: McpToolContext): void {
  const { manager, registerWorkspaceTool, tabTool } = context
  // Each MCP session gets its own server, so tracked screenshots never cross sessions.
  const observations = new ScreenshotObservations()
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
        maxHeight: z.number().int().min(64).max(7680).optional(),
        trackChanges: z.boolean().optional()
          .describe('Plain viewport capture only: also return an observationId to pass as ifChangedSince later.'),
        ifChangedSince: z.string().uuid().optional()
          .describe('Plain viewport capture only: an observationId from this session. Returns no image when the pixels match it.')
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
      trackChanges?: boolean
      ifChangedSince?: string
    }, call: WorkspaceToolCall<PageObservationSettlement>) => {
      const { trackChanges, ifChangedSince, ...captureOptions } = options
      if (trackChanges || ifChangedSince !== undefined) {
        if (trackChanges === false || captureOptions.fullPage || captureOptions.ref !== undefined || captureOptions.selector !== undefined || captureOptions.clip || captureOptions.annotateRefs) {
          throw new TypeError('trackChanges and ifChangedSince support plain viewport screenshots only; omit fullPage, ref, selector, clip and annotateRefs, and do not set trackChanges to false')
        }
        const tabId = call.tabId ?? captureOptions.tabId
        const previewBefore = manager.cssStatePreviewMarker(tabId)
        const capture = await manager.trackedScreenshot({ ...captureOptions, tabId })
        const observation = observations.observe(call.workspaceId, capture, ifChangedSince)
        const cssStatePreview = previewBefore ?? manager.cssStatePreviewMarker(tabId)
        const note = observation.status === 'UNCHANGED'
          ? 'The viewport pixels match that observation, so no image is returned. This does not prove that the page or its state is unchanged, that nothing changed in between, or that an action failed or succeeded.'
          : undefined
        return { content: [
          { type: 'text' as const, text: JSON.stringify({ observation, width: capture.pixels.width, height: capture.pixels.height, ...(note ? { note } : {}) }) },
          ...(cssStatePreview ? [{ type: 'text' as const, text: JSON.stringify({ cssStatePreview, note: 'Captured while a forced CSS state was applied; this is not natural page state.' }) }] : []),
          ...(observation.status === 'UNCHANGED' ? [] : [{ type: 'image' as const, data: capture.data.toString('base64'), mimeType: capture.mimeType }])
        ] }
      }
      const previewBefore = manager.cssStatePreviewMarker(options.tabId)
      const image = await manager.screenshot(options)
      const cssStatePreview = previewBefore ?? manager.cssStatePreviewMarker(options.tabId)
      return { content: [
        ...(image.annotations ? [{ type: 'text' as const, text: JSON.stringify(image.annotations) }] : []),
        ...(cssStatePreview ? [{ type: 'text' as const, text: JSON.stringify({ cssStatePreview, note: 'Captured while a forced CSS state was applied; this is not natural page state.' }) }] : []),
        { type: 'image' as const, data: image.data.toString('base64'), mimeType: image.mimeType }
      ] }
    }),
    { settlement: () => pageObservationSettlement(manager), continuityInspection: () => true, publicObserverAllowed: true }
  )
}
