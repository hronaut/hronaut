import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { WEB_STORAGE_INPUT_ERRORS, WebStorageInputError, type WebStorageProgress, webStorageFailure } from '../../../browser/web-storage-operation.js'
import { McpCapabilityAuthorizationError } from '../../capability-profile-store.js'
import { errorResult, textResult } from '../../tool-results.js'
import type { ToolActivityClassification } from '../tool-context.js'

/**
 * How a local or session storage call settles. A failure reports whether the page-side operation was submitted
 * and acknowledged; a success is published only after its own publication check. A list or get only reads. The tab
 * activity waits for the settled result.
 */
export function webStorageSettlement(mutation: boolean) {
  let progress: WebStorageProgress = { mutation, executionSubmitted: false, executionAcknowledged: false }
  let policy: Record<string, unknown> | undefined
  let inputError: keyof typeof WEB_STORAGE_INPUT_ERRORS | undefined
  let reviewFinalizationFailed = false
  let publication: (() => void) | undefined
  let finishActivity: ((result: CallToolResult) => void) | undefined
  let finishing = false
  const rememberInputPolicy = (error: unknown): void => {
    if (!progress.executionSubmitted && error instanceof WebStorageInputError) inputError = error.reason
    if (error instanceof McpCapabilityAuthorizationError) policy = { permission: 'denied', policyDecision: error.decision }
  }
  const settle = (result: CallToolResult): CallToolResult => {
    let settled = result
    if (result.isError) {
      const outcome = { ...webStorageFailure(progress), ...policy,
        ...(!progress.executionSubmitted && inputError
          ? { reason: inputError, message: WEB_STORAGE_INPUT_ERRORS[inputError] } : {}),
        ...(reviewFinalizationFailed ? { reviewFinalization: 'failed' } : {}),
        ...(result.structuredContent?.permission === 'denied' ? { permission: 'denied', policyDecision: result.structuredContent.policyDecision } : {}) }
      settled = { ...textResult(outcome), structuredContent: outcome, isError: true }
    }
    finishActivity?.(settled)
    return settled
  }
  return {
    storage: 'web' as const,
    recordProgress: (next: WebStorageProgress): void => { progress = { ...next } },
    retainPublication: (validate: () => void): void => { publication = validate },
    rememberInputPolicy,
    reviewFinalizationFailed: (): void => { if (progress.executionSubmitted) reviewFinalizationFailed = true },
    deferActivity: (finish: (result: CallToolResult) => void): boolean => {
      if (finishing) return false
      finishActivity = settled => { finishing = true; finish(settled) }
      return true
    },
    settleDenied: (denied: CallToolResult): CallToolResult => settle(denied),
    publish: (result: CallToolResult): CallToolResult => {
      if (!result.isError) {
        if (!publication) throw new Error('Storage publication guard is unavailable')
        publication()
      }
      return settle(result) // No await after the final publication guard.
    },
    settleError: (error: unknown): CallToolResult => { rememberInputPolicy(error); return settle(errorResult(error)) },
    classifyActivity: (activity: ToolActivityClassification, failed: boolean): ToolActivityClassification => ({
      readOnly: activity.readOnly || progress.mutation === false,
      dispatched: progress.executionSubmitted,
      invalidatedOutcome: progress.mutation && progress.executionSubmitted && failed ? 'outcome-unknown' : undefined
    })
  }
}

export type WebStorageSettlement = ReturnType<typeof webStorageSettlement>
