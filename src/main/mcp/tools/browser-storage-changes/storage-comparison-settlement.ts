import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { STORAGE_COMPARISON_INPUT_ERRORS, StorageComparisonInputError, storageComparisonFailure } from '../../../browser/storage-comparison-operation.js'
import { McpCapabilityAuthorizationError } from '../../capability-profile-store.js'
import { errorResult, textResult } from '../../tool-results.js'
import type { ToolActivityClassification } from '../tool-context.js'

/**
 * How a storage comparison settles. Its result is published only while the retained comparison guard still holds;
 * a failure reports whether the stored baseline changed. The call counts as a read unless it changed the baseline,
 * and the tab activity waits for the settled result.
 */
export function storageComparisonSettlement() {
  let started = false
  let changed = false
  let inputError: keyof typeof STORAGE_COMPARISON_INPUT_ERRORS | undefined
  let publication: { validate(): void; dispose(): void } | undefined
  let policy: Record<string, unknown> | undefined
  let reviewFinalizationFailed = false
  let finishActivity: ((result: CallToolResult) => void) | undefined
  let finishing = false
  const rememberInputPolicy = (error: unknown): void => {
    if (error instanceof StorageComparisonInputError) inputError = error.reason
    if (error instanceof McpCapabilityAuthorizationError) policy = { permission: 'denied', policyDecision: error.decision }
  }
  const settle = (result: CallToolResult): CallToolResult => {
    let settled = result
    let current = false
    try {
      if (!result.isError && !publication) throw new Error('Storage comparison publication guard is unavailable')
      publication?.validate()
      current = publication !== undefined
    } catch (error) { rememberInputPolicy(error); settled = errorResult(error) }
    if (settled.isError) {
      const outcome = { ...storageComparisonFailure(changed), ...policy,
        ...(current && !changed && !policy && !reviewFinalizationFailed && inputError
          ? { status: 'REJECTED', reason: inputError, message: STORAGE_COMPARISON_INPUT_ERRORS[inputError] } : {}),
        ...(reviewFinalizationFailed ? { reviewFinalization: 'failed' } : {}),
        ...(result.structuredContent?.permission === 'denied' ? { permission: 'denied', policyDecision: result.structuredContent.policyDecision } : {}) }
      settled = { ...textResult(outcome), structuredContent: outcome, isError: true }
    }
    finishActivity?.(settled)
    return settled
  }
  return {
    markStarted: (): void => { started = true },
    markChanged: (): void => { changed = true },
    retainPublication: (guard: { validate(): void; dispose(): void }): void => { publication = guard },
    rememberInputPolicy,
    reviewFinalizationFailed: (): void => { if (started) reviewFinalizationFailed = true },
    deferActivity: (finish: (result: CallToolResult) => void): boolean => {
      if (finishing) return false
      finishActivity = settled => { finishing = true; finish(settled) }
      return true
    },
    settleDenied: (denied: CallToolResult): CallToolResult => settle(denied),
    publish: (result: CallToolResult): CallToolResult => settle(result), // No await after the final publication guard.
    settleError: (error: unknown): CallToolResult => { rememberInputPolicy(error); return settle(errorResult(error)) },
    classifyActivity: (_activity: ToolActivityClassification, failed: boolean): ToolActivityClassification => ({
      readOnly: !changed,
      dispatched: started,
      invalidatedOutcome: changed && failed ? 'outcome-unknown' : undefined
    }),
    dispose: (): void => { publication?.dispose() }
  }
}

export type StorageComparisonSettlement = ReturnType<typeof storageComparisonSettlement>
