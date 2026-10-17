import { z } from 'zod'
import { textResult, toolDescription } from '../../tool-results.js'
import { tabIdSchema } from '../../tool-schemas.js'
import type { McpToolContext } from '../tool-context.js'

export function registerBrowserPdfSave(context: McpToolContext): void {
  const { frameRequests, manager, registerWorkspaceTool, tabTool } = context
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
    tabTool('browser_pdf_save', async ({ validateExport, ...options }: {
      tabId?: string
      filename?: string
      landscape?: boolean
      pageSize?: 'A4' | 'Letter' | 'Legal'
      outline?: boolean
      preferCSSPageSize?: boolean
      validateExport?: () => void
    }) => {
      if (!validateExport) throw new Error('PDF export authority is unavailable')
      return textResult(await manager.savePdf(options, validateExport, pending => { frameRequests.getStore()!.pdfExport = pending }))
    })
  )
}
