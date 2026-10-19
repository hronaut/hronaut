import { z } from 'zod'
import { WorkerEvaluationStoppedError } from '../../../browser/worker-evaluation/worker-evaluation.js'
import { WORKER_EVALUATION_ACTIONS, WORKER_EVALUATION_LIMITS, type WorkerEvaluationAction } from '../../../../shared/worker-evaluation.js'
import { textResult, toolDescription } from '../../tool-results.js'
import { tabIdSchema } from '../../tool-schemas.js'
import type { McpToolContext, ToolActivityClassification, WorkspaceToolCall } from '../tool-context.js'

/**
 * How an evaluation stopped waiting for its script, if it did: one sent
 * leaves its audit outcome unknown, and one never sent did not dispatch.
 */
function workerEvaluationSettlement() {
  let stoppedScript: 'sent' | 'unsent' | undefined
  return {
    stopped: (sent: boolean): void => { stoppedScript = sent ? 'sent' : 'unsent' },
    effectsPossible: (): boolean => stoppedScript === 'sent',
    classifyActivity: (activity: ToolActivityClassification): ToolActivityClassification =>
      stoppedScript === 'unsent' ? { ...activity, dispatched: false } : activity
  }
}

export function registerBrowserWorkers(context: McpToolContext): void {
  const { manager, registerWorkspaceTool, tabTool } = context
  registerWorkspaceTool(
    'browser_workers',
    {
      description: toolDescription('browser_workers'),
      inputSchema: {
        tabId: tabIdSchema,
        action: z.enum(WORKER_EVALUATION_ACTIONS),
        worker: z.string().min(1).max(WORKER_EVALUATION_LIMITS.maxHandleChars).optional()
          .describe('With evaluate: a worker handle from this tab\'s latest list'),
        script: z.string().min(1).max(WORKER_EVALUATION_LIMITS.maxScriptChars).optional()
          .describe('With evaluate: the JavaScript expression to run in that worker; a returned promise is awaited'),
        timeoutMs: z.number().int().min(1).max(WORKER_EVALUATION_LIMITS.maxTimeoutMs).optional()
          .describe(`With evaluate: how long to wait for the script; default ${WORKER_EVALUATION_LIMITS.defaultTimeoutMs}`)
      }
    },
    tabTool('browser_workers', async ({ tabId, action, worker, script, timeoutMs }: {
      tabId: string
      action: WorkerEvaluationAction
      worker?: string
      script?: string
      timeoutMs?: number
    }, call: WorkspaceToolCall<ReturnType<typeof workerEvaluationSettlement>>) => {
      // Checked before each dispatch and before a result is kept, without renewing the agent's write ownership.
      const authority = { assertCurrent: (origin: string) => call.validateLifecycle(origin) }
      if (action === 'list') {
        if (worker !== undefined || script !== undefined || timeoutMs !== undefined) throw new Error('worker, script and timeoutMs are only for action evaluate')
        return textResult(await manager.listWorkers(tabId, authority))
      }
      if (worker === undefined || script === undefined) throw new Error('evaluate needs a worker handle from list and a script')
      const deadlineMs = timeoutMs ?? WORKER_EVALUATION_LIMITS.defaultTimeoutMs
      try {
        return textResult(await manager.evaluateInWorker(tabId, worker, script, { timeoutMs: deadlineMs, signal: call.signal }, authority))
      } catch (error) {
        if (!(error instanceof WorkerEvaluationStoppedError)) throw error
        call.settlement.stopped(error.sent)
        const outcome = error.sent
          ? { status: 'OUTCOME_UNKNOWN', reason: error.reason, dispatch: 'dispatched', effects: 'possible', retrySafe: false, timeoutMs: deadlineMs, detail: error.message,
              nextAction: 'Inspect fresh worker or page state before continuing; do not repeat the script blindly.' }
          : { status: 'NOT_DISPATCHED', reason: error.reason, dispatch: 'not-dispatched', effects: 'none', retrySafe: true, timeoutMs: deadlineMs, detail: error.message,
              nextAction: 'Nothing ran. Retry with a larger timeoutMs if the deadline passed.' }
        return { ...textResult(outcome), structuredContent: outcome, isError: true }
      }
    }),
    { readOnly: input => input.action === 'list', settlement: workerEvaluationSettlement }
  )
}
