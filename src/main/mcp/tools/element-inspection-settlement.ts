import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { PendingElementInspection } from '../../browser/element-inspection-publication.js'
import { errorResult } from '../tool-results.js'
import type { WorkspaceToolCall } from './tool-context.js'

/**
 * How the element, media and image inspection tools settle a call. The page-side reading is held until the call
 * settles and is published only if the call still holds its target then. With `holdsActivity`, the tab activity
 * also waits for the settled result, because an image sizing report is classified by what was published.
 */
export function elementInspectionSettlement(holdsActivity: boolean) {
  let pending: PendingElementInspection | undefined
  let call: WorkspaceToolCall<unknown> | undefined
  let finishActivity: ((result: CallToolResult) => void) | undefined
  let finishing = false
  const settle = (result: CallToolResult): CallToolResult => {
    if (holdsActivity) {
      const finish = finishActivity
      finishActivity = undefined
      finish?.(result)
    }
    return result
  }
  return {
    retain: (inspection: PendingElementInspection): void => { pending = inspection },
    cancelledMessage: 'Element inspection cancelled',
    prepare: (admitted: WorkspaceToolCall<unknown>): void => { call = admitted },
    recheckAfterDispatch: (): void => { call!.requireCurrentTarget() },
    deferActivity: (finish: (result: CallToolResult) => void): boolean => {
      if (!holdsActivity || finishing) return false
      finishActivity = settled => { finishing = true; finish(settled) }
      return true
    },
    settleDenied: (denied: CallToolResult): CallToolResult | undefined => holdsActivity ? settle(denied) : undefined,
    publish: (result: CallToolResult): CallToolResult | Promise<CallToolResult> | undefined => {
      if (result.isError) return holdsActivity ? settle(result) : undefined
      return (async () => {
        // Validate the captured context after every audit/capability await.
        // Opt-in occupancy also settles its page-side identity/type guard.
        const inspection = pending
        if (!inspection) throw new Error('Element inspection publication guard is unavailable')
        await inspection.finish()
        inspection.assertCurrent()
        return settle(result) // No await between final authority check and publication.
      })()
    },
    settleError: (error: unknown): CallToolResult | undefined => holdsActivity ? settle(errorResult(error)) : undefined,
    dispose: (): void => { pending?.discard() }
  }
}

export type ElementInspectionSettlement = ReturnType<typeof elementInspectionSettlement>
