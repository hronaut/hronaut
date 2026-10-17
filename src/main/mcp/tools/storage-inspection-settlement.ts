import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { storageInspectionFailure } from '../../browser/storage-inspection-operation.js'
import { McpCapabilityAuthorizationError } from '../capability-profile-store.js'
import { errorResult, textResult } from '../tool-results.js'
import type { ToolActivityClassification } from './tool-context.js'

/**
 * How browser_indexeddb and browser_storage_usage settle a call. A reading is published only after its own
 * publication check; once the read started or was denied, a failure reports a bounded storage inspection failure.
 * The tab activity waits for the settled result.
 */
export function storageInspectionSettlement() {
  let started = false
  let publication: (() => void) | undefined
  let policy: Record<string, unknown> | undefined
  let reviewFinalizationFailed = false
  let finishActivity: ((result: CallToolResult) => void) | undefined
  let finishing = false
  const rememberInputPolicy = (error: unknown): void => {
    if (error instanceof McpCapabilityAuthorizationError) policy = { permission: 'denied', policyDecision: error.decision }
  }
  const settle = (result: CallToolResult): CallToolResult => {
    let settled = result
    try {
      if (!result.isError && !publication) throw new Error('Storage inspection publication guard is unavailable')
      publication?.()
    } catch (error) { rememberInputPolicy(error); settled = errorResult(error) }
    if (settled.isError && (publication || started || policy)) {
      const outcome = { ...storageInspectionFailure(), ...policy,
        ...(reviewFinalizationFailed ? { reviewFinalization: 'failed' } : {}),
        ...(result.structuredContent?.permission === 'denied' ? { permission: 'denied', policyDecision: result.structuredContent.policyDecision } : {}) }
      settled = { ...textResult(outcome), structuredContent: outcome, isError: true }
    }
    finishActivity?.(settled)
    return settled
  }
  return {
    markStarted: (): void => { started = true },
    retainPublication: (validate: () => void): void => { publication = validate },
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
    classifyActivity: (activity: ToolActivityClassification): ToolActivityClassification => ({ ...activity, dispatched: started })
  }
}

export type StorageInspectionSettlement = ReturnType<typeof storageInspectionSettlement>
