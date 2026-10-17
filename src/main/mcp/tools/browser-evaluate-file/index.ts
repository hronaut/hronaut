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
      workspaceId: string; tabId: string; source: FileEvaluationSource
    }, call) => {
      const validateFileEvaluation = (): void => {
        if (call.signal?.aborted) throw new Error('File evaluation cancelled')
        call.requireCurrentTarget()
        const certificate = frameRequests.getStore()!.fileEvaluationCertificate
        if (!certificate) throw new Error('File evaluation certificate unavailable')
        certificate()
        if (call.authorityRejection()) throw new Error('File evaluation authority changed')
      }
      const progress = frameRequests.getStore()!.fileEvaluation!
      if (input.source.workspaceId !== input.workspaceId || input.source.tabId !== input.tabId) {
        const outcome = fileEvaluationFailure(progress, 'TUPLE_TARGET_MISMATCH')
        return { ...textResult(outcome), structuredContent: outcome, isError: true }
      }
      validateFileEvaluation()
      const outcome = await manager.evaluateFile(input.source, {
        signal: call.signal, validate: validateFileEvaluation,
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
