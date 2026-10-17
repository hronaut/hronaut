import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { type CookieWriteProgress, cookieWriteFailure } from '../../../browser/cookie-write-operation.js'
import { McpCapabilityAuthorizationError } from '../../capability-profile-store.js'
import { errorResult, textResult } from '../../tool-results.js'
import type { ToolActivityClassification } from '../tool-context.js'

/**
 * How a cookie write (set, delete or clear) settles. A failure reports how many writes were attempted and
 * acknowledged; a success is published only after the write's own publication check. The tab activity waits for
 * the settled result.
 */
export function cookieWriteSettlement() {
  let progress: CookieWriteProgress = { attemptedWrites: 0, acknowledgedWrites: 0 }
  let policy: Record<string, unknown> | undefined
  let reviewFinalizationFailed = false
  let publication: (() => void) | undefined
  let finishActivity: ((result: CallToolResult) => void) | undefined
  let finishing = false
  const rememberInputPolicy = (error: unknown): void => {
    if (error instanceof McpCapabilityAuthorizationError) policy = { permission: 'denied', policyDecision: error.decision }
  }
  const settle = (result: CallToolResult): CallToolResult => {
    let settled = result
    if (result.isError) {
      const outcome = { ...cookieWriteFailure(progress), ...policy,
        ...(reviewFinalizationFailed ? { reviewFinalization: 'failed' } : {}),
        ...(result.structuredContent?.permission === 'denied' ? { permission: 'denied', policyDecision: result.structuredContent.policyDecision } : {}) }
      settled = { ...textResult(outcome), structuredContent: outcome, isError: true }
    }
    finishActivity?.(settled)
    return settled
  }
  return {
    storage: 'cookies' as const,
    recordProgress: (next: CookieWriteProgress): void => { progress = { ...next } },
    retainPublication: (validate: () => void): void => { publication = validate },
    rememberInputPolicy,
    reviewFinalizationFailed: (): void => { if (progress.attemptedWrites) reviewFinalizationFailed = true },
    deferActivity: (finish: (result: CallToolResult) => void): boolean => {
      if (finishing) return false
      finishActivity = settled => { finishing = true; finish(settled) }
      return true
    },
    settleDenied: (denied: CallToolResult): CallToolResult => settle(denied),
    publish: (result: CallToolResult): CallToolResult => {
      if (!result.isError) {
        if (!publication) throw new Error('Cookie publication guard is unavailable')
        publication()
      }
      return settle(result) // No await after the final publication guard.
    },
    settleError: (error: unknown): CallToolResult => { rememberInputPolicy(error); return settle(errorResult(error)) },
    classifyActivity: (activity: ToolActivityClassification, failed: boolean): ToolActivityClassification => ({
      ...activity,
      dispatched: progress.attemptedWrites > 0,
      invalidatedOutcome: progress.attemptedWrites > 0 && failed ? 'outcome-unknown' : undefined
    })
  }
}

export type CookieWriteSettlement = ReturnType<typeof cookieWriteSettlement>
