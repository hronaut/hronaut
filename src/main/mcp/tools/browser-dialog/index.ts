import { z } from 'zod'
import { textResult, toolDescription } from '../../tool-results.js'
import { tabIdSchema } from '../../tool-schemas.js'
import type { McpToolContext } from '../tool-context.js'
import { handleDialog } from '../../../browser/website-dialogs/website-dialogs.js'

export function registerBrowserDialog(context: McpToolContext): void {
  const { manager, registerWorkspaceTool, tabTool } = context
  registerWorkspaceTool(
    'browser_dialog',
    {
      description: toolDescription('browser_dialog'),
      inputSchema: {
        action: z.enum(['accept', 'dismiss']),
        tabId: tabIdSchema.optional(),
        dialogId: z.string().uuid().optional().describe(
          'The id of the dialog you read, from the tab\'s dialog or the note that named it. Only that dialog is answered, not one the page showed after it.'
        )
      }
    },
    tabTool('browser_dialog', async ({ action, tabId, dialogId }: {
      action: 'accept' | 'dismiss'
      tabId?: string
      dialogId?: string
    }) => textResult(await handleDialog(manager, action, tabId, dialogId))),
    { alongsideWorkspaceChange: true }
  )
}
