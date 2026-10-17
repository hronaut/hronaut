import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { FRAME_OBSERVATION_LIMITS } from '../../../../shared/frame-observation.js'
import type { PendingFrameObservation } from '../../../browser/frame-observation.js'
import { frameObservationResult } from '../../frame-observation-result.js'
import type { WorkspaceToolCall } from '../tool-context.js'

/**
 * How a `frameSelector` snapshot settles a call. The frame capture is held until the call settles and is published
 * only if the call still holds its target and the frame is still the captured one then.
 */
export function frameObservationSettlement(input: Record<string, unknown>) {
  let pending: PendingFrameObservation | undefined
  let call: WorkspaceToolCall<unknown> | undefined
  return {
    retain: (observation: PendingFrameObservation): void => { pending = observation },
    cancelledMessage: 'Frame observation cancelled',
    authorizesResolvedTab: true,
    admit: (): undefined => {
      if ((input.action !== undefined && input.action !== 'capture')
        || ['rootSelector','baselineId','maxOutputChars','advanceBaseline','expectedOrigin','expectedText','expectedSelector'].some(key => input[key] !== undefined)
        || (typeof input.maxChars === 'number' && input.maxChars > FRAME_OBSERVATION_LIMITS.maxChars)) {
        throw new Error('frameSelector supports capture only, with maxChars at most 16000 and no root, baseline, delta or quality options')
      }
      return undefined
    },
    prepare: (admitted: WorkspaceToolCall<unknown>): void => { call = admitted },
    capabilityInput: (dispatched: Record<string, unknown>): Record<string, unknown> =>
      call?.tabId ? { ...dispatched, tabId: call.tabId } : dispatched,
    publish: (result: CallToolResult): Promise<CallToolResult> | undefined => {
      const observation = pending
      if (!observation || result.isError) return undefined
      return (async () => {
        await observation.finish()
        const settled = frameObservationResult(observation.snapshot)
        call?.requireCurrentTarget()
        observation.assertCurrent()
        return settled
      })()
    },
    dispose: (): void => { pending?.discard() }
  }
}

export type FrameObservationSettlement = ReturnType<typeof frameObservationSettlement>
