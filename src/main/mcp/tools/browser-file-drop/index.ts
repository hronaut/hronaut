import { z } from 'zod'
import { agentCursorIdentity } from '../../agent-presence.js'
import { textResult, toolDescription } from '../../tool-results.js'
import { tabIdSchema } from '../../tool-schemas.js'
import type { McpToolContext } from '../tool-context.js'
import { dropFiles } from '../../../browser/file-drop/file-drop.js'

export function registerBrowserFileDrop(context: McpToolContext): void {
  const { client, manager, registerWorkspaceTool, tabTool } = context
  registerWorkspaceTool(
    'browser_file_drop',
    {
      description: toolDescription('browser_file_drop'),
      inputSchema: {
        tabId: tabIdSchema.optional(),
        ref: z.string().optional(),
        selector: z.string().optional(),
        paths: z.array(z.string()).min(1).max(20)
      }
    },
    tabTool('browser_file_drop', async ({ paths, ...target }: {
      tabId?: string; ref?: string; selector?: string; paths: string[]
    }, call) => {
      // Re-checks the call before each drag event reaches the page.
      const validateDrop = (validateContext: () => void): void => {
        try {
          if (call.signal?.aborted) throw new Error('File drop cancelled; earlier effects are not rolled back')
          call.requireCurrentTarget()
          call.requirePostWriteContext()
          validateContext()
          if (call.authorityRejection()) throw new Error('File drop authority changed; inspect fresh state before continuing')
        } catch (error) {
          call.setInvalidatedOutcome('outcome-unknown')
          throw error
        }
      }
      return textResult(await dropFiles(manager, target, paths, validateDrop, agentCursorIdentity(client.name)))
    }),
    { stepTarget: input => ({ ref: input.ref }) }
  )
}
