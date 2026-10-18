import { z } from 'zod'
import { textResult, toolDescription } from '../../tool-results.js'
import { tabIdSchema } from '../../tool-schemas.js'
import type { McpToolContext, WorkspaceToolCall } from '../tool-context.js'
import { type ScreenshotExportSettlement, screenshotExportSettlement } from './screenshot-save-settlement.js'

export function registerBrowserScreenshotSave(context: McpToolContext): void {
  const { manager, registerWorkspaceTool, tabTool } = context
  registerWorkspaceTool(
    'browser_screenshot_save',
    {
      description: toolDescription('browser_screenshot_save'),
      inputSchema: {
        tabId: tabIdSchema.optional(),
        filename: z.string().min(1).max(180).optional(),
        maxWidth: z.number().int().min(64).max(7680).optional(),
        maxHeight: z.number().int().min(64).max(7680).optional()
      }
    },
    tabTool('browser_screenshot_save', async (options: {
      tabId?: string
      filename?: string
      maxWidth?: number
      maxHeight?: number
    }, call: WorkspaceToolCall<ScreenshotExportSettlement>) => {
      const validateExport = (): void => {
        if (call.signal?.aborted) throw new Error('Screenshot export cancelled')
        call.requireCurrentTarget()
      }
      const previewBefore = manager.cssStatePreviewMarker(options.tabId)
      const exported = await manager.saveScreenshot(options, validateExport, pending => { call.settlement.retain(pending) })
      const cssStatePreview = previewBefore ?? manager.cssStatePreviewMarker(options.tabId)
      return textResult({
        ...exported,
        ...(cssStatePreview ? { cssStatePreview, note: 'Captured while a forced CSS state was applied; this is not natural page state.' } : {})
      })
    }),
    { settlement: screenshotExportSettlement, inputSchema: shape => z.object(shape).strict() }
  )
}
