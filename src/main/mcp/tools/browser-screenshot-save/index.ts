import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import type { PendingScreenshotExport, ScreenshotExport } from '../../../browser/screenshot-export/screenshot-export.js'
import { textResult, toolDescription } from '../../tool-results.js'
import { tabIdSchema } from '../../tool-schemas.js'
import type { McpToolContext, WorkspaceToolCall } from '../tool-context.js'

/**
 * Holds the saved screenshot until the call settles: it is published only if the call still has its authority then.
 * When that final check fails, the file is already on disk, so the error names it instead of implying nothing was saved.
 */
function screenshotExportSettlement() {
  let pending: PendingScreenshotExport | undefined
  let saved: Pick<ScreenshotExport, 'filename' | 'path'> | undefined
  return {
    retain: (exported: PendingScreenshotExport, file: Pick<ScreenshotExport, 'filename' | 'path'>): void => {
      pending = exported
      saved = file
    },
    publish: (result: CallToolResult): CallToolResult | undefined => {
      if (result.isError) return undefined
      if (!pending || !saved) throw new Error('Screenshot export publication guard is unavailable')
      try {
        pending.assertCurrent()
      } catch (error) {
        const outcome = {
          status: 'SAVED_UNCONFIRMED',
          filename: saved.filename,
          path: saved.path,
          retrySafe: false,
          reason: error instanceof Error ? error.message : String(error),
          nextAction: 'The screenshot file was written before this check failed and stays in the downloads folder. Inspect the page again before saving another; do not save again automatically.'
        }
        return { ...textResult(outcome), structuredContent: outcome, isError: true }
      }
      return result // No await after the final cancellation/context/authority check.
    },
    dispose: (): void => { pending?.discard() }
  }
}

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
    }, call: WorkspaceToolCall<ReturnType<typeof screenshotExportSettlement>>) => {
      const validateExport = (): void => {
        if (call.signal?.aborted) throw new Error('Screenshot export cancelled')
        call.requireCurrentTarget()
      }
      let retained: PendingScreenshotExport | undefined
      const previewBefore = manager.cssStatePreviewMarker(options.tabId)
      const exported = await manager.saveScreenshot(options, validateExport, pending => { retained = pending })
      if (retained) call.settlement.retain(retained, exported)
      const cssStatePreview = previewBefore ?? manager.cssStatePreviewMarker(options.tabId)
      return textResult({
        ...exported,
        ...(cssStatePreview ? { cssStatePreview, note: 'Captured while a forced CSS state was applied; this is not natural page state.' } : {})
      })
    }),
    { settlement: screenshotExportSettlement, inputSchema: shape => z.object(shape).strict() }
  )
}
