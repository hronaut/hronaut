import { z } from 'zod'
import type { TextFileFillProgress } from '../../../browser/text-file-fill/text-file-fill.js'
import { textResult, toolDescription } from '../../tool-results.js'
import { tabIdSchema } from '../../tool-schemas.js'
import type { McpToolContext, WorkspaceToolCall } from '../tool-context.js'
import { type FillSettlement, fillSettlement } from './fill-settlement.js'

export function registerBrowserFillFromFile(context: McpToolContext): void {
  const { manager, registerWorkspaceTool, tabTool } = context
  registerWorkspaceTool(
    'browser_fill_from_file',
    {
      description: toolDescription('browser_fill_from_file'),
      inputSchema: {
        tabId: tabIdSchema.optional(),
        ref: z.string().optional(),
        selector: z.string().optional(),
        path: z.string().min(1).max(4096)
          .describe('Absolute path of a UTF-8 text file of at most 64 KiB; its whole text replaces the field value.'),
        expectedOrigin: z.string().min(1).max(2048)
          .describe('Origin of the page the text is meant for, such as https://app.example.com; any other origin is refused.'),
        sha256: z.string().regex(/^[a-f0-9]{64}$/u).optional()
          .describe('SHA-256 of the file bytes in lowercase hex; a file that differs is refused.')
      }
    },
    tabTool('browser_fill_from_file', async ({ path, expectedOrigin, sha256, ...target }: {
      tabId?: string; ref?: string; selector?: string; path: string; expectedOrigin: string; sha256?: string
    }, call: WorkspaceToolCall<FillSettlement>) => {
      const progress: TextFileFillProgress = { written: false }
      // Re-checks the call after the file is read, before the text is written, and before its result is published.
      const validateFill = (validateContext: () => void): void => {
        try {
          if (call.signal?.aborted) {
            throw new Error(progress.written
              ? 'Fill from file cancelled after the text was written; the field may have it, so read it before filling again'
              : 'Fill from file cancelled before the text was written; nothing was filled')
          }
          call.requireCurrentTarget()
          call.requirePostWriteContext()
          validateContext()
          if (call.authorityRejection()) {
            throw new Error(progress.written
              ? 'Authority changed after the text was written; the field may have it, so inspect fresh state before filling again'
              : 'Authority changed before the text was written; nothing was filled. Inspect fresh state before continuing')
          }
        } catch (error) {
          // Once the text was written the page may have it: never classify the failure as safe to replay.
          call.setInvalidatedOutcome(progress.written ? 'outcome-unknown' : undefined)
          throw error
        }
      }
      try {
        const result = await manager.fillFromFile(target, { path, expectedOrigin, sha256 }, validateFill, progress)
        return { ...textResult(result), structuredContent: { ...result } }
      } catch (error) {
        // Also a failure after writing that the checks above never saw.
        if (progress.written) call.setInvalidatedOutcome('outcome-unknown')
        throw error
      }
    }),
    { stepTarget: input => ({ ref: input.ref }), settlement: () => fillSettlement() }
  )
}
