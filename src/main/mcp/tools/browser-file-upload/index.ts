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
    tabTool('browser_file_upload', async ({ paths, ...target }: {
      tabId?: string; ref?: string; selector?: string; paths: string[]
    }, call) => {
      const validateUpload = (validateContext: () => void): void => {
        try {
          if (call.signal?.aborted) throw new Error('File upload cancelled; earlier effects are not rolled back')
          call.requireCurrentTarget()
          call.requirePostWriteContext()
          validateContext()
          if (call.authorityRejection()) throw new Error('File upload authority changed; inspect fresh state before continuing')
        } catch (error) {
          call.setInvalidatedOutcome('outcome-unknown')
          throw error
        }
      }
      return textResult(await manager.uploadFiles(target, paths, validateUpload))
    }),
    { stepTarget: input => ({ ref: input.ref }) }
  )
}
