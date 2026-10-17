import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { NativeKeyHoldProgress } from '../../../browser/native-key-hold.js'
import { McpCapabilityAuthorizationError } from '../../capability-profile-store.js'
import { errorResult, nativeKeyHoldNotDispatchedResult, nativeKeyHoldUnknownResult } from '../../tool-results.js'
import type { ToolActivityClassification, WorkspaceToolCall } from '../tool-context.js'

/**
 * How a native key hold settles. The hold's progress decides the result: before the key down was attempted
 * nothing was dispatched, and once it was, any failure leaves the outcome (and the key release) unknown.
 */
export function keyHoldSettlement() {
  let progress: NativeKeyHoldProgress | undefined
  let policy: Record<string, unknown> | undefined
  let reviewFinalizationFailed = false
  let publication: (() => void) | undefined
  return {
    progress: (): NativeKeyHoldProgress | undefined => progress,
    recordProgress: (next: NativeKeyHoldProgress): void => { progress = { ...next } },
    prepare: (call: WorkspaceToolCall<unknown>): void => {
      publication = () => {
        if (call.signal?.aborted) throw new Error('Key hold cancelled after dispatch')
        call.requireCurrentTarget()
        if (call.authorityRejection()) throw new Error('Key hold authority changed after dispatch')
      }
    },
    beforeDispatch: (): void => {
      progress = { downAttempted: false, downAcknowledged: false, releaseStarted: false, releaseAttempted: false, releaseAcknowledged: false }
    },
    rememberInputPolicy: (error: unknown): void => {
      if (progress && error instanceof McpCapabilityAuthorizationError) policy = { permission: 'denied', policyDecision: error.decision }
    },
    afterDispatch: (result: CallToolResult): void => {
      if (result.isError && result.structuredContent?.policyDecision !== undefined) {
        policy = { permission: 'denied', policyDecision: result.structuredContent.policyDecision }
      }
    },
    recheckAfterDispatch: (): void => { publication!() },
    reviewFinalizationFailed: (): void => { if (progress?.downAttempted) reviewFinalizationFailed = true },
    settleDenied: (denied: CallToolResult, outcome: Record<string, unknown>): CallToolResult | undefined => {
      if (progress?.downAttempted) return nativeKeyHoldUnknownResult(progress, reviewFinalizationFailed, outcome)
      return progress ? nativeKeyHoldNotDispatchedResult(denied) : undefined
    },
    publish: (result: CallToolResult): CallToolResult | undefined => {
      if (progress && !progress.downAttempted && result.isError) return nativeKeyHoldNotDispatchedResult(result, policy)
      if (!progress?.downAttempted) return undefined
      if (result.isError) return nativeKeyHoldUnknownResult(progress, reviewFinalizationFailed, policy ?? result.structuredContent)
      if (!publication) throw new Error('Key hold publication guard is unavailable')
      publication()
      return result // No await after final authority and cancellation check.
    },
    settleError: (error: unknown): CallToolResult | undefined => {
      if (progress?.downAttempted) return nativeKeyHoldUnknownResult(progress, reviewFinalizationFailed,
        error instanceof McpCapabilityAuthorizationError ? { permission: 'denied', policyDecision: error.decision } : policy ?? errorResult(error).structuredContent)
      return progress ? nativeKeyHoldNotDispatchedResult(errorResult(error), policy) : undefined
    },
    classifyActivity: (activity: ToolActivityClassification, failed: boolean): ToolActivityClassification => progress ? {
      ...activity,
      dispatched: progress.downAttempted,
      invalidatedOutcome: progress.downAttempted && failed ? 'outcome-unknown' : activity.invalidatedOutcome
    } : activity
  }
}

export type KeyHoldSettlement = ReturnType<typeof keyHoldSettlement>
