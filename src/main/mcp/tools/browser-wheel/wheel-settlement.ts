import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { nativeWheelUnknownResult } from '../../tool-results.js'
import type { ToolActivityClassification, WorkspaceToolCall } from '../tool-context.js'

/**
 * How a native wheel call settles. Once the wheel event was attempted it may have scrolled the page, so a failure
 * from then on reports an unknown outcome, and a success is published only if the call still holds its target.
 */
export function wheelSettlement() {
  let attempted = false
  let reviewFinalizationFailed = false
  let publication: (() => void) | undefined
  return {
    markAttempted: (): void => { attempted = true },
    prepare: (call: WorkspaceToolCall<unknown>): void => {
      publication = () => {
        if (call.signal?.aborted) throw new Error('Wheel request cancelled after dispatch')
        call.requireCurrentTarget()
        if (call.authorityRejection()) throw new Error('Wheel authority changed after dispatch')
      }
    },
    recheckAfterDispatch: (): void => { publication!() },
    reviewFinalizationFailed: (): void => { if (attempted) reviewFinalizationFailed = true },
    publish: (result: CallToolResult): CallToolResult | undefined => {
      if (!attempted) return undefined
      if (result.isError) {
        if (result.structuredContent?.status === 'OUTCOME_UNKNOWN' && result.structuredContent.retrySafe === false
          && result.structuredContent.effects === 'possible' && !reviewFinalizationFailed) return result
        return nativeWheelUnknownResult(reviewFinalizationFailed)
      }
      if (!publication) throw new Error('Wheel publication guard is unavailable')
      publication()
      return result // No await after final wheel authority/cancellation check.
    },
    settleError: (): CallToolResult | undefined => attempted ? nativeWheelUnknownResult(reviewFinalizationFailed) : undefined,
    classifyActivity: (activity: ToolActivityClassification, failed: boolean): ToolActivityClassification =>
      attempted && failed ? { ...activity, invalidatedOutcome: 'outcome-unknown' } : activity
  }
}

export type WheelSettlement = ReturnType<typeof wheelSettlement>
