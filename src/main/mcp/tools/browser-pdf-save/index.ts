import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import type { PendingPdfExport } from '../../../browser/pdf-export-publication.js'
import { textResult, toolDescription } from '../../tool-results.js'
import { tabIdSchema } from '../../tool-schemas.js'
import type { McpToolContext, WorkspaceToolCall } from '../tool-context.js'

// Holds the written PDF until the call settles: it is published only if the call still has its authority then.
function pdfExportSettlement() {
  let pending: PendingPdfExport | undefined
  return {
    retain: (exported: PendingPdfExport): void => { pending = exported },
    publish: (result: CallToolResult): CallToolResult | undefined => {
      if (result.isError) return undefined
      if (!pending) throw new Error('PDF export publication guard is unavailable')
      pending.assertCurrent()
      return result // No await after the final cancellation/context/authority check.
    },
    dispose: (): void => { pending?.discard() }
  }
}

export function registerBrowserPdfSave(context: McpToolContext): void {
  const { manager, registerWorkspaceTool, tabTool } = context
  registerWorkspaceTool(
    'browser_pdf_save',
    {
      description: toolDescription('browser_pdf_save'),
      inputSchema: {
        tabId: tabIdSchema.optional(),
        filename: z.string().min(1).max(180).optional(),
        landscape: z.boolean().optional(),
        pageSize: z.enum(['A4', 'Letter', 'Legal']).optional(),
        outline: z.boolean().optional()
          .describe('Experimental: add bookmarks from the page headings. Makes a tagged PDF; off by default.'),
        preferCSSPageSize: z.boolean().optional()
          .describe('Use the paper size from the page\'s CSS @page rule where it sets one, over pageSize and landscape. Off by default; refused above 1,000 pages.')
      }
    },
    tabTool('browser_pdf_save', async (options: {
      tabId?: string
      filename?: string
      landscape?: boolean
      pageSize?: 'A4' | 'Letter' | 'Legal'
      outline?: boolean
      preferCSSPageSize?: boolean
    }, call: WorkspaceToolCall<ReturnType<typeof pdfExportSettlement>>) => {
      const validateExport = (): void => {
        if (call.signal?.aborted) throw new Error('PDF export cancelled')
        call.requireCurrentTarget()
      }
      return textResult(await manager.savePdf(options, validateExport, pending => { call.settlement.retain(pending) }))
    }),
    { settlement: pdfExportSettlement }
  )
}
