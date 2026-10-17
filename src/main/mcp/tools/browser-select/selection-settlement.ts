import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { McpCapabilityAuthorizationError } from '../../capability-profile-store.js'
import { errorResult, selectionNotSubmittedResult, selectionUnknownResult } from '../../tool-results.js'
import type { ToolActivityClassification, WorkspaceToolCall } from '../tool-context.js'

/**
 * How a multi-value selection settles. Before submission nothing was selected, so any result says so. After
 * submission a failure leaves the selection unknown unless the page rejected it with no effects, and a success is
 * published only if the call still holds its target and the retained selection authority. The tab activity waits
 * for the settled result.
 */
export function selectionSettlement() {
  let submitted = false
  let authority: { validate: () => void; dispose: () => void } | undefined
  let policy: Record<string, unknown> | undefined
  let reviewFinalizationFailed = false
  let call: WorkspaceToolCall<unknown> | undefined
  let publication: (() => void) | undefined
  let finishActivity: ((result: CallToolResult) => void) | undefined
  let finishing = false
  const settle = (result: CallToolResult): CallToolResult => {
    const settled = !submitted ? selectionNotSubmittedResult(result) : result
    finishActivity?.(settled)
    return settled
  }
  return {
    retainAuthority: (retained: { validate: () => void; dispose: () => void }): void => { authority = retained },
    markSubmitted: (): void => { submitted = true },
    prepare: (admitted: WorkspaceToolCall<unknown>): void => {
      call = admitted
      publication = () => {
        if (admitted.signal?.aborted) throw new Error('Selection cancelled after submission')
        admitted.requireCurrentTarget()
        admitted.requirePostWriteContext()
        if (admitted.authorityRejection()) throw new Error('Selection authority changed after submission')
      }
    },
    rememberInputPolicy: (error: unknown): void => {
      if (submitted && error instanceof McpCapabilityAuthorizationError) policy = { permission: 'denied', policyDecision: error.decision }
    },
    afterDispatch: (result: CallToolResult): void => {
      if (result.structuredContent?.status === 'OUTCOME_UNKNOWN') call!.setInvalidatedOutcome('outcome-unknown')
    },
    reviewFinalizationFailed: (): void => { if (submitted) reviewFinalizationFailed = true },
    deferActivity: (finish: (result: CallToolResult) => void): boolean => {
      if (finishing) return false
      finishActivity = settled => { finishing = true; finish(settled) }
      return true
    },
    settleDenied: (denied: CallToolResult, outcome: Record<string, unknown>): CallToolResult =>
      settle(submitted ? selectionUnknownResult(reviewFinalizationFailed, outcome) : denied),
    publish: (result: CallToolResult): CallToolResult => {
      if (!submitted) return settle(result)
      if (!authority || !publication) throw new Error('Selection publication guard is unavailable')
      authority.validate()
      publication()
      if (result.isError && (result.structuredContent?.status !== 'REJECTED' || result.structuredContent.effects !== 'none'
        || reviewFinalizationFailed)) return settle(selectionUnknownResult(reviewFinalizationFailed, policy ?? result.structuredContent))
      return settle(result) // No await after all settlement and final authority checks.
    },
    settleError: (error: unknown): CallToolResult => settle(submitted
      ? selectionUnknownResult(reviewFinalizationFailed, error instanceof McpCapabilityAuthorizationError ? { permission: 'denied', policyDecision: error.decision } : policy ?? errorResult(error).structuredContent)
      : errorResult(error)),
    classifyActivity: (activity: ToolActivityClassification, failed: boolean, result: CallToolResult | undefined): ToolActivityClassification => {
      const effectsPossible = submitted && result?.structuredContent?.effects !== 'none'
      return {
        ...activity,
        dispatched: effectsPossible,
        invalidatedOutcome: effectsPossible && failed ? 'outcome-unknown' : effectsPossible ? activity.invalidatedOutcome : undefined
      }
    },
    dispose: (): void => { authority?.dispose() }
  }
}

export type SelectionSettlement = ReturnType<typeof selectionSettlement>
