import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { type NativeTouchProgress, notStartedTouchProgress } from '../../../browser/agent-touch/agent-touch.js'
import { McpCapabilityAuthorizationError } from '../../capability-profile-store.js'
import { errorResult, textResult } from '../../tool-results.js'
import type { ToolActivityClassification, WorkspaceToolCall } from '../tool-context.js'

/** Where the gesture's finger was left: lifted by its end, cancelled, dropped by Chromium without the page confirming it, or possibly still down. */
const contactOf = (progress: NativeTouchProgress): 'ENDED' | 'CANCELLED' | 'CLEARED' | 'UNCONFIRMED' =>
  progress.endAcknowledged ? 'ENDED' : progress.cancelAcknowledged ? 'CANCELLED' : progress.contactCleared ? 'CLEARED' : 'UNCONFIRMED'

/** A gesture whose first touch event was attempted but whose outcome could not be confirmed, with how far it got. */
export function nativeTouchUnknownResult(progress: NativeTouchProgress, reviewFinalizationFailed = false, policy?: Record<string, unknown>): CallToolResult {
  const contact = contactOf(progress)
  const outcome = {
    status: 'OUTCOME_UNKNOWN', reason: 'TOUCH_GESTURE_UNCERTAIN', retrySafe: false, effects: 'possible',
    moves: progress.movesAcknowledged,
    contact,
    ...(reviewFinalizationFailed ? { reviewFinalization: 'failed' } : {}),
    ...(policy?.permission === 'denied' || policy?.policyDecision !== undefined ? { permission: 'denied', policyDecision: policy.policyDecision } : {}),
    nextAction: contact === 'UNCONFIRMED'
      ? 'A touch gesture was attempted and its contact was not confirmed lifted. Inspect fresh page state; never automatically replay. Close this tab before another touch gesture on it.'
      : 'A touch gesture was attempted and may have reached the page. Inspect fresh page state before continuing; do not automatically replay.'
  }
  return { ...textResult(outcome), structuredContent: outcome, isError: true }
}

/** A gesture that failed before its first touch event, keeping the rejection's own detail. */
export function nativeTouchNotDispatchedResult(result: CallToolResult, policy?: Record<string, unknown>): CallToolResult {
  const detail = result.structuredContent ? undefined : result.content.find(item => item.type === 'text')?.text.slice(0, 500)
  const outcome = {
    ...result.structuredContent, ...policy, status: 'NOT_DISPATCHED', reason: 'TOUCH_NOT_DISPATCHED', effects: 'none', dispatch: 'not-dispatched', retrySafe: false,
    postcondition: 'not-established', reconciliationRequired: false, ...(detail ? { detail } : {}),
    nextAction: 'No touch event was sent. Inspect the rejection and fresh page state before a new gesture.'
  }
  return { ...textResult(outcome), structuredContent: outcome, isError: true }
}

/**
 * How a touch gesture settles. Before its first touch event was attempted nothing reached the page, so a failure
 * reports that nothing was dispatched. From then on the page may have responded, so a failure reports an unknown
 * outcome with the gesture's progress, and a success is published only if the call still holds its target.
 */
export function touchSettlement() {
  let progress: NativeTouchProgress | undefined
  let policy: Record<string, unknown> | undefined
  let reviewFinalizationFailed = false
  let publication: (() => void) | undefined
  const attempted = (): boolean => progress?.startAttempted === true
  return {
    progress: (): NativeTouchProgress | undefined => progress,
    recordProgress: (next: NativeTouchProgress): void => { progress = { ...next } },
    prepare: (call: WorkspaceToolCall<unknown>): void => {
      publication = () => {
        if (call.signal?.aborted) throw new Error('Touch gesture cancelled after dispatch')
        call.requireCurrentTarget()
        if (call.authorityRejection()) throw new Error('Touch gesture authority changed after dispatch')
      }
    },
    beforeDispatch: (): void => { progress = notStartedTouchProgress() },
    rememberInputPolicy: (error: unknown): void => {
      if (progress && error instanceof McpCapabilityAuthorizationError) policy = { permission: 'denied', policyDecision: error.decision }
    },
    // A gesture that sent nothing has no effects for the guard to vouch for.
    recheckAfterDispatch: (): void => { if (attempted()) publication!() },
    reviewFinalizationFailed: (): void => { if (attempted()) reviewFinalizationFailed = true },
    effectsPossible: (): boolean => attempted(),
    settleDenied: (denied: CallToolResult, outcome: Record<string, unknown>): CallToolResult | undefined => {
      if (attempted()) return nativeTouchUnknownResult(progress!, reviewFinalizationFailed, outcome)
      return progress ? nativeTouchNotDispatchedResult(denied) : undefined
    },
    publish: (result: CallToolResult): CallToolResult | undefined => {
      if (progress && !progress.startAttempted && result.isError) return nativeTouchNotDispatchedResult(result, policy)
      if (!attempted()) return undefined
      if (result.isError) return nativeTouchUnknownResult(progress!, reviewFinalizationFailed, policy)
      if (!publication) throw new Error('Touch gesture publication guard is unavailable')
      publication()
      return result // No await after final touch authority/cancellation check.
    },
    settleError: (error: unknown): CallToolResult | undefined => {
      const denial = error instanceof McpCapabilityAuthorizationError ? { permission: 'denied', policyDecision: error.decision } : policy
      if (attempted()) return nativeTouchUnknownResult(progress!, reviewFinalizationFailed, denial)
      return progress ? nativeTouchNotDispatchedResult(errorResult(error), policy) : undefined
    },
    classifyActivity: (activity: ToolActivityClassification, failed: boolean): ToolActivityClassification => progress ? {
      ...activity,
      dispatched: progress.startAttempted,
      invalidatedOutcome: progress.startAttempted && failed ? 'outcome-unknown' : activity.invalidatedOutcome
    } : activity
  }
}

export type TouchSettlement = ReturnType<typeof touchSettlement>
