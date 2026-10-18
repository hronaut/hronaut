import { z } from 'zod'
import { EvaluationStoppedError } from '../../../browser/page-evaluation/evaluate.js'
import { safeValue, textResult, toolDescription } from '../../tool-results.js'
import { tabIdSchema } from '../../tool-schemas.js'
import type { McpToolContext, WorkspaceToolCall } from '../tool-context.js'

/** Whether the call stopped waiting while its script may still run, so its audit records the outcome as unknown. */
function evaluationSettlement() {
  let stillRunning = false
  return {
    stoppedWhileRunning: (): void => { stillRunning = true },
    effectsPossible: (): boolean => stillRunning
  }
}

export function registerBrowserEvaluate(context: McpToolContext): void {
  const { manager, registerWorkspaceTool, tabTool } = context
  registerWorkspaceTool(
    'browser_evaluate',
    {
      description: toolDescription('browser_evaluate'),
      inputSchema: {
        script: z.string().min(1),
        tabId: tabIdSchema.optional(),
        dialogAction: z.enum(['accept', 'dismiss']).optional(),
        timeoutMs: z.number().int().min(1).max(300_000).default(30_000)
      }
    },
    tabTool('browser_evaluate', async ({ script, tabId, dialogAction, timeoutMs }: {
      script: string
      tabId?: string
      dialogAction?: 'accept' | 'dismiss'
      timeoutMs: number
    }, call: WorkspaceToolCall<ReturnType<typeof evaluationSettlement>>) => {
      try {
        return textResult(safeValue(await manager.evaluate(script, tabId, { dialogAction }, { timeoutMs, signal: call.signal })))
      } catch (error) {
        if (!(error instanceof EvaluationStoppedError)) throw error
        if (error.sent) call.settlement.stoppedWhileRunning()
        const outcome = error.sent
          ? { status: 'OUTCOME_UNKNOWN', reason: error.reason, retrySafe: false, timeoutMs, detail: error.message,
              nextAction: 'Inspect fresh page state before continuing; do not repeat the script blindly. Pass a larger timeoutMs for a script that needs more time.' }
          : { status: 'NOT_DISPATCHED', reason: error.reason, retrySafe: true, timeoutMs, detail: error.message }
        return { ...textResult(outcome), structuredContent: outcome, isError: true }
      }
    }),
    { settlement: evaluationSettlement }
  )
}
