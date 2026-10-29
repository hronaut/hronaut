import { z } from 'zod'
import { EvaluationStoppedError } from '../../../browser/page-evaluation/evaluation-stopped-error.js'
import { safeValue, textResult, toolDescription } from '../../tool-results.js'
import { tabIdSchema } from '../../tool-schemas.js'
import type { McpToolContext, ToolActivityClassification, WorkspaceToolCall } from '../tool-context.js'

/**
 * How the call stopped waiting for its script, if it did: one still running
 * leaves its audit outcome unknown, and one never sent did not dispatch.
 */
function evaluationSettlement() {
  let stoppedScript: 'running' | 'unsent' | undefined
  return {
    stopped: (sent: boolean): void => { stoppedScript = sent ? 'running' : 'unsent' },
    effectsPossible: (): boolean => stoppedScript === 'running',
    classifyActivity: (activity: ToolActivityClassification): ToolActivityClassification =>
      stoppedScript === 'unsent' ? { ...activity, dispatched: false } : activity
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
        call.settlement.stopped(error.sent)
        const outcome = error.sent
          ? { status: 'OUTCOME_UNKNOWN', reason: error.reason, dispatch: 'dispatched', effects: 'possible', retrySafe: false, timeoutMs, detail: error.message,
              nextAction: 'Inspect fresh page state before continuing; do not repeat the script blindly. A script that needs more time can pass a larger timeoutMs, within the client\'s own request timeout.' }
          : { status: 'NOT_DISPATCHED', reason: error.reason, dispatch: 'not-dispatched', effects: 'none', retrySafe: true, timeoutMs, detail: error.message,
              nextAction: 'Nothing ran. Retry when the tab is ready, with a larger timeoutMs if the deadline passed.' }
        return { ...textResult(outcome), structuredContent: outcome, isError: true }
      }
    }),
    { settlement: evaluationSettlement }
  )
}
