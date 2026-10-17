import { z } from 'zod'
import { CSS_INSPECTION_PROPERTIES, type CssInspectionProperty } from '../../../../shared/css-provenance.js'
import { MAX_COMPARED_TEXT_VALUE_LENGTH } from '../../../../shared/value-comparison.js'
import { textResult, toolDescription } from '../../tool-results.js'
import { tabIdSchema } from '../../tool-schemas.js'
import { type ElementInspectionSettlement, elementInspectionSettlement } from '../element-inspection-settlement.js'
import type { McpToolContext, WorkspaceToolCall } from '../tool-context.js'

export function registerBrowserElementInspect(context: McpToolContext): void {
  const { manager, registerWorkspaceTool, tabTool } = context
  registerWorkspaceTool(
    'browser_element_inspect',
    {
      description: toolDescription('browser_element_inspect'),
      inputSchema: {
        tabId: tabIdSchema.optional(),
        ref: z.string().max(200).optional(),
        selector: z.string().max(1_000).optional(),
        cssProperties: z.array(z.enum(CSS_INSPECTION_PROPERTIES)).min(1).max(8).optional(),
        includeFonts: z.boolean().optional(),
        includeScroll: z.boolean().optional(),
        includePasswordOccupancy: z.boolean().optional(),
        includeSizingInputs: z.boolean().optional().describe('Selected-element computed sizing inputs only; no flex participation, applicability, parent context, cause, resolved base size or cascade winner claim. Requires one unique selector in an active tab.'),
        includeValidity: z.boolean().optional(),
        expectedValue: z.string().max(MAX_COMPARED_TEXT_VALUE_LENGTH).optional()
          .describe('Compare one unique rendered native text input or textarea, selected by CSS, with this exact string. Returns only match, mismatch or unavailable; neither value is echoed.')
      }
    },
    tabTool('browser_element_inspect', async (options: {
      tabId?: string
      ref?: string
      selector?: string
      cssProperties?: CssInspectionProperty[]
      includeFonts?: boolean
      includeScroll?: boolean
      includePasswordOccupancy?: boolean
      includeSizingInputs?: boolean
      includeValidity?: boolean
      expectedValue?: string
    }, call: WorkspaceToolCall<ElementInspectionSettlement>) => {
      const previewBefore = manager.cssStatePreviewMarker(options.tabId)
      const inspection = await manager.elementInspection(options, call.requireCurrentTarget, pending => { call.settlement.retain(pending) })
      const cssStatePreview = previewBefore ?? manager.cssStatePreviewMarker(options.tabId)
      return textResult(cssStatePreview ? { ...inspection, cssStatePreview } : inspection)
    }),
    {
      // Sizing inputs describe images, so that report waits for the settled result like browser_image_state.
      settlement: input => elementInspectionSettlement(input.includeSizingInputs === true),
      // A guarded inspection reads page-side state without moving the person's view of the page.
      preservesPresentation: input => input.includePasswordOccupancy === true || input.includeValidity === true
        || input.includeSizingInputs === true || input.expectedValue !== undefined
    }
  )
}
