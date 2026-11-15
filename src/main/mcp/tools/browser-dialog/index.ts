import { z } from 'zod'
import { textResult, toolDescription } from '../../tool-results.js'
import { tabIdSchema } from '../../tool-schemas.js'
import type { McpToolContext, ToolActivityClassification, WorkspaceToolCall } from '../tool-context.js'
import { handleDialog, WebsiteDialogChangedError } from '../../../browser/website-dialogs/website-dialogs.js'

/** Whether the call answered nothing because the tab no longer showed the dialog the agent named. */
function dialogSettlement() {
  let refused = false
  return {
    refused: (): void => { refused = true },
    classifyActivity: (activity: ToolActivityClassification): ToolActivityClassification =>
      refused ? { ...activity, dispatched: false } : activity
  }
}

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
    }, call: WorkspaceToolCall<ReturnType<typeof dialogSettlement>>) => {
      try {
        return textResult(await handleDialog(manager, action, tabId, dialogId))
      } catch (error) {
        if (!(error instanceof WebsiteDialogChangedError)) throw error
        call.settlement.refused()
        const outcome = { status: 'NOT_DISPATCHED', reason: 'DIALOG_CHANGED', dispatch: 'not-dispatched', effects: 'none', retrySafe: false,
          detail: error.message,
          nextAction: 'Nothing was answered. Read the tab again; answer a dialog it shows only if you mean that one, with its own dialogId.' }
        return { ...textResult(outcome), structuredContent: outcome, isError: true }
      }
    }),
    { alongsideWorkspaceChange: true, settlement: dialogSettlement }
  )
}
