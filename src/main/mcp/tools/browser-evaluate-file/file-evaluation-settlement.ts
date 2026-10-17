import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { type FileEvaluationProgress, type FileEvaluationSource, fileEvaluationFailure } from '../../../../shared/file-evaluation.js'
import { textResult } from '../../tool-results.js'
import type { ToolActivityClassification } from '../tool-context.js'

const PUBLIC_FAILURE_REASONS = new Set(['UNSUPPORTED_PLATFORM', 'INVALID_PATH', 'INVALID_REQUEST', 'CANCELLED', 'DEADLINE', 'BUSY', 'CLEANUP_UNKNOWN', 'INVALID_FILE_TYPE', 'FILE_CHANGED', 'TOO_LARGE', 'DIGEST_MISMATCH', 'INVALID_UTF8', 'IO_FAILURE', 'SCRIPT_FAILED', 'CANCELLED_OR_DEADLINE', 'TUPLE_TARGET_MISMATCH'])

/**
 * How a local file evaluation settles. It needs its own capability grant and a human-waiting dispatch certificate,
 * which is refreshed before publication. A failure reports only a bounded public reason and whether the script was
 * submitted. The workspace writer stays held until the native evaluation and its cleanup finish, even after the
 * call returns, and the tab activity waits for the settled result.
 */
export function fileEvaluationSettlement(input: Record<string, unknown>, hasCapability: boolean) {
  const progress: FileEvaluationProgress = { submitted: false, acknowledged: false }
  let certificate: (() => void) | undefined
  let refreshCertificate: (() => Promise<void>) | undefined
  let publication: { validate(): void; dispose(): void } | undefined
  let completion: Promise<void> | undefined
  let finishActivity: ((result: CallToolResult) => void) | undefined
  let finishing = false
  const settle = (result: CallToolResult): CallToolResult => {
    if (!result.isError) { finishActivity?.(result); return result }
    const reason = result.structuredContent?.reason
    const outcome = fileEvaluationFailure(progress, typeof reason === 'string' && PUBLIC_FAILURE_REASONS.has(reason) ? reason : 'UNAVAILABLE_OR_UNAUTHORIZED')
    const settled = { ...textResult(outcome), structuredContent: outcome, isError: true }
    finishActivity?.(settled)
    return settled
  }
  return {
    progress,
    certificate: (): (() => void) | undefined => certificate,
    retainPublication: (authority: { validate(): void; dispose(): void }): void => { publication = authority },
    retainCompletion: (retained: Promise<void>): void => { completion = retained },
    admit: (): CallToolResult | undefined => {
      if (!hasCapability) {
        const outcome = fileEvaluationFailure({ submitted: false, acknowledged: false }, 'SEPARATE_GRANT_REQUIRED')
        return { ...textResult(outcome), structuredContent: outcome, isError: true }
      }
      const source = input.source as FileEvaluationSource
      if (source.workspaceId !== input.workspaceId || source.tabId !== input.tabId) {
        const outcome = fileEvaluationFailure(progress, 'TUPLE_TARGET_MISMATCH')
        return { ...textResult(outcome), structuredContent: outcome, isError: true }
      }
      return undefined
    },
    certify: async (certifyDispatch: (() => Promise<() => void>) | undefined): Promise<void> => {
      if (!certifyDispatch) throw new Error('Human waiting authority unavailable')
      refreshCertificate = async () => { certificate = await certifyDispatch() }
      await refreshCertificate()
    },
    deferActivity: (finish: (result: CallToolResult) => void): boolean => {
      if (finishing) return false
      finishActivity = settled => { finishing = true; finish(settled) }
      return true
    },
    effectsPossible: (): boolean => progress.submitted,
    settleDenied: (denied: CallToolResult): CallToolResult => settle(denied),
    publish: (result: CallToolResult): CallToolResult | Promise<CallToolResult> => {
      if (result.isError) return settle(result)
      return (async () => {
        if (!refreshCertificate || !publication) throw new Error('File publication authority unavailable')
        await refreshCertificate()
        publication.validate()
        return settle(result) // No await after the final publication guard.
      })()
    },
    settleError: (): CallToolResult => settle({ content: [], isError: true }),
    classifyActivity: (activity: ToolActivityClassification, failed: boolean): ToolActivityClassification => ({
      ...activity,
      dispatched: progress.submitted,
      invalidatedOutcome: progress.submitted && failed ? 'outcome-unknown' : undefined
    }),
    pendingCompletion: (): Promise<void> | undefined => completion,
    dispose: (): void => { publication?.dispose() }
  }
}

export type FileEvaluationSettlement = ReturnType<typeof fileEvaluationSettlement>
