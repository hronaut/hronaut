import { type FileEvaluationSource, fileEvaluationFailure, fileEvaluationSourceSchema } from '../../../../shared/file-evaluation.js'
import { safeValue, textResult, toolDescription } from '../../tool-results.js'
import { tabIdSchema } from '../../tool-schemas.js'
import type { McpToolContext } from '../tool-context.js'

export function registerBrowserEvaluateFile(context: McpToolContext): void {
  const { frameRequests, manager, registerWorkspaceTool, tabTool } = context
  registerWorkspaceTool(
    'browser_evaluate_file',
    { description: toolDescription('browser_evaluate_file'), inputSchema: { source: fileEvaluationSourceSchema, tabId: tabIdSchema } },
    tabTool('browser_evaluate_file', async (input: {
      workspaceId: string; tabId: string; source: FileEvaluationSource;
      fileEvaluationSignal?: AbortSignal; validateFileEvaluation: () => void
    }) => {
      const progress = frameRequests.getStore()!.fileEvaluation!
      if (input.source.workspaceId !== input.workspaceId || input.source.tabId !== input.tabId) {
        const outcome = fileEvaluationFailure(progress, 'TUPLE_TARGET_MISMATCH')
        return { ...textResult(outcome), structuredContent: outcome, isError: true }
      }
      input.validateFileEvaluation()
      const outcome = await manager.evaluateFile(input.source, {
        signal: input.fileEvaluationSignal, validate: input.validateFileEvaluation,
        retainPublication: authority => { frameRequests.getStore()!.fileEvaluationPublication = authority },
        retainCompletion: completion => { frameRequests.getStore()!.fileEvaluationCompletion = completion },
        submitted: () => { progress.submitted = true }
      })
      progress.acknowledged = outcome.acknowledged === true
      const result: Record<string, unknown> = { ...outcome, ...(Object.hasOwn(outcome, 'value') ? { value: safeValue(outcome.value) } : {}) }
      return { ...textResult(result), structuredContent: result, ...(result.status !== 'RETURNED' ? { isError: true } : {}) }
    }, 'never')
  )
}
