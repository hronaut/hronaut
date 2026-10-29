import { z } from 'zod'
import { MAX_INSERTED_TEXT_LENGTH } from '../../../browser/text-insertion/inserted-text.js'
import type { TextInsertionProgress } from '../../../browser/text-insertion/text-insertion.js'
import { textResult, toolDescription } from '../../tool-results.js'
import { tabIdSchema } from '../../tool-schemas.js'
import type { McpToolContext } from '../tool-context.js'

export function registerBrowserInsertText(context: McpToolContext): void {
  const { manager, registerWorkspaceTool, tabTool } = context
  registerWorkspaceTool(
    'browser_insert_text',
    {
      description: toolDescription('browser_insert_text'),
      inputSchema: {
        tabId: tabIdSchema.optional(),
        ref: z.string().optional(),
        selector: z.string().optional(),
        text: z.string().min(1).max(MAX_INSERTED_TEXT_LENGTH)
          .describe('Text to insert at the caret or in place of the selection; \\n for line breaks, tabs allowed, no other control characters.')
      }
    },
    tabTool('browser_insert_text', async ({ text, ...target }: { tabId?: string; ref?: string; selector?: string; text: string }, call) => {
      const progress: TextInsertionProgress = { sent: false }
      // Re-checks the call before the text is sent and before its result is published.
      const validateInsertion = (validateContext: () => void): void => {
        try {
          if (call.signal?.aborted) {
            throw new Error(progress.sent
              ? 'Text insertion cancelled after the text was sent; it may be in the editor, so read it before inserting again'
              : 'Text insertion cancelled before the text was sent; nothing was inserted')
          }
          call.requireCurrentTarget()
          call.requirePostWriteContext()
          validateContext()
          if (call.authorityRejection()) {
            throw new Error(progress.sent
              ? 'Native input authority changed after the text was sent; it may be in the editor, so inspect fresh state before inserting again'
              : 'Native input authority changed before the text was sent; nothing was inserted. Inspect fresh state before continuing')
          }
        } catch (error) {
          // Once the text was sent it may be in the editor: never classify the failure as safe to replay.
          call.setInvalidatedOutcome(progress.sent ? 'outcome-unknown' : undefined)
          throw error
        }
      }
      try {
        return textResult(await manager.insertText(target, text, validateInsertion, progress))
      } catch (error) {
        // Also a failure after sending that the checks above never saw, such as restoring a locked tab's input guard.
        if (progress.sent) call.setInvalidatedOutcome('outcome-unknown')
        throw error
      }
    }),
    { stepTarget: input => ({ ref: input.ref }) }
  )
}
