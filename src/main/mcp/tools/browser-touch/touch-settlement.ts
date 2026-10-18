import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { NativeTouchProgress } from '../../../browser/agent-touch/agent-touch.js'
import { textResult } from '../../tool-results.js'
import type { ToolActivityClassification, WorkspaceToolCall } from '../tool-context.js'

/** A gesture whose first touch event was attempted but whose outcome could not be confirmed, with how far it got. */
export function nativeTouchUnknownResult(progress: NativeTouchProgress, reviewFinalizationFailed = false): CallToolResult {
  const outcome = {
    status: 'OUTCOME_UNKNOWN', reason: 'TOUCH_GESTURE_UNCERTAIN', retrySafe: false, effects: 'possible',
    moves: progress.movesAcknowledged,
    contact: progress.endAcknowledged ? 'ENDED' : progress.cancelAcknowledged ? 'CANCELLED' : 'UNCONFIRMED',
    ...(reviewFinalizationFailed ? { reviewFinalization: 'failed' } : {}),
    nextAction: progress.endAcknowledged || progress.cancelAcknowledged
      ? 'A touch gesture was attempted and may have reached the page. Inspect fresh page state before continuing; do not automatically replay.'
      : 'A touch gesture was attempted and its contact was not confirmed lifted. Inspect fresh page state; never automatically replay. Close this tab before another touch gesture on it.'
  }
  return { ...textResult(outcome), structuredContent: outcome, isError: true }
}

/**
 * How a touch gesture settles. Once its first touch event was attempted the page may have responded, so a failure
 * from then on reports an unknown outcome with the gesture's progress, and a success is published only if the call
 * still holds its target.
 */
export function touchSettlement() {
  let progress: NativeTouchProgress | undefined
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
    recheckAfterDispatch: (): void => { publication!() },
    reviewFinalizationFailed: (): void => { if (attempted()) reviewFinalizationFailed = true },
    publish: (result: CallToolResult): CallToolResult | undefined => {
      if (!attempted()) return undefined
      if (result.isError) return nativeTouchUnknownResult(progress!, reviewFinalizationFailed)
      if (!publication) throw new Error('Touch gesture publication guard is unavailable')
      publication()
      return result // No await after final touch authority/cancellation check.
    },
    settleError: (): CallToolResult | undefined => attempted() ? nativeTouchUnknownResult(progress!, reviewFinalizationFailed) : undefined,
    classifyActivity: (activity: ToolActivityClassification, failed: boolean): ToolActivityClassification => progress ? {
      ...activity,
      dispatched: progress.startAttempted,
      invalidatedOutcome: progress.startAttempted && failed ? 'outcome-unknown' : activity.invalidatedOutcome
    } : activity
  }
}

export type TouchSettlement = ReturnType<typeof touchSettlement>
