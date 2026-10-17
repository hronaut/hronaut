import { z } from 'zod'
import { textResult, toolDescription } from '../../tool-results.js'
import { tabIdSchema } from '../../tool-schemas.js'
import type { McpToolContext } from '../tool-context.js'

export function registerBrowserFileUpload(context: McpToolContext): void {
  const { manager, registerWorkspaceTool, tabTool } = context
  registerWorkspaceTool(
    'browser_file_upload',
    {
      description: toolDescription('browser_file_upload'),
      inputSchema: {
        tabId: tabIdSchema.optional(),
        ref: z.string().optional(),
        selector: z.string().optional(),
        paths: z.array(z.string()).min(1).max(20)
      }
    },
    tabTool('browser_file_upload', async ({ validateUpload, paths, ...target }: {
      tabId?: string; ref?: string; selector?: string; paths: string[]
      validateUpload?: (validateContext: () => void) => void
    }) => {
      if (!validateUpload) throw new Error('File upload authority is unavailable')
      return textResult(await manager.uploadFiles(target, paths, validateUpload))
    })
  )
}
