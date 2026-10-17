import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { BrowserTabsManager } from '../../../browser/tabs-manager.js'
import { McpCapabilityAuthorizationError } from '../../capability-profile-store.js'
import { errorResult, mcpWorkspaceState, textResult } from '../../tool-results.js'
import type { WorkspaceToolCall } from '../tool-context.js'

/**
 * How a labeled tab creation settles. It holds a human-waiting dispatch certificate, refreshed before publication,
 * and a guard on the workspace it observed when admitted. Once creation started, any failure other than a known
 * unsaved label reports that the tab, its navigation or its label may already exist. The tool reports its own tab
 * activity once the call settles.
 */
export function labeledCreationSettlement(manager: BrowserTabsManager, input: Record<string, unknown>) {
  let attempted = false
  let policy: Record<string, unknown> | undefined
  let certificate: (() => void) | undefined
  let refreshCertificate: (() => Promise<void>) | undefined
  let reviewFinalizationFailed = false
  let cancelled: (() => boolean) | undefined
  let publication: (() => void) | undefined
  let finish: ((result: CallToolResult) => void) | undefined
  let knownNotSaved = false
  const rememberInputPolicy = (error: unknown): void => {
    if (error instanceof McpCapabilityAuthorizationError) {
      policy = { ...policy, permission: 'denied', ...(error.decision ? { policyDecision: error.decision } : {}) }
    }
  }
  const settle = (result: CallToolResult): CallToolResult => {
    if (!attempted && result.isError) return result
    let settled: CallToolResult
    try {
      if (!publication) throw new Error('Creation publication guard unavailable')
      publication()
      if (reviewFinalizationFailed) throw new Error('Review finalization failed')
      if (result.isError && !(knownNotSaved && result.structuredContent?.status === 'LABEL_NOT_SAVED')) throw new Error('Creation settlement failed')
      const state = mcpWorkspaceState(manager.getMcpGroupState(String(input.workspaceId)))
      settled = { ...result, content: result.content.map(item => item.type === 'text' ? { ...item, text: JSON.stringify({ ...JSON.parse(item.text), ...state }, null, 2) } : item) }
    } catch (error) {
      rememberInputPolicy(error)
      const policyDecision = (error instanceof McpCapabilityAuthorizationError ? error.decision : undefined)
        ?? policy?.policyDecision ?? result.structuredContent?.policyDecision
      const outcome = {
        status: attempted ? 'OUTCOME_UNKNOWN' : 'NOT_DISPATCHED',
        effects: attempted ? 'possible' : 'none', retrySafe: false,
        ...policy,
        ...(result.structuredContent?.permission === 'denied' ? { permission: 'denied' } : {}),
        ...(policyDecision ? { permission: 'denied', policyDecision } : {}),
        ...(reviewFinalizationFailed ? { reviewFinalization: 'failed' } : {}),
        nextAction: 'Obtain current authorized workspace state before continuing. Tab creation, navigation or label persistence may already have occurred; do not automatically repeat this request.'
      }
      settled = { ...textResult(outcome), structuredContent: outcome, isError: true }
    }
    const finished = finish
    finish = undefined
    finished?.(settled)
    return settled
  }
  return {
    publication: (): (() => void) | undefined => publication,
    retainPublication: (guard: () => void): void => { publication = guard },
    retainFinish: (finished: (result: CallToolResult) => void): void => { finish = finished },
    cancelled: (): boolean => cancelled?.() === true,
    markAttempted: (): void => { attempted = true },
    recordLabelNotSaved: (notSaved: boolean): void => { knownNotSaved = notSaved },
    prepare: (call: WorkspaceToolCall<unknown>): void => {
      const requireCreationWorkspace = manager.captureWorkspaceObservationGuard(call.workspaceId)
      cancelled = () => call.signal?.aborted === true
      publication = () => {
        if (call.signal?.aborted) throw new Error('Labeled creation cancelled')
        call.requireCurrentTarget()
        requireCreationWorkspace()
        if (!certificate) throw new Error('Labeled creation certificate unavailable')
        certificate()
      }
    },
    rememberInputPolicy,
    certify: async (certifyDispatch: (() => Promise<() => void>) | undefined): Promise<void> => {
      refreshCertificate = async () => { certificate = certifyDispatch ? await certifyDispatch() : () => undefined }
      await refreshCertificate()
    },
    reviewFinalizationFailed: (): void => { reviewFinalizationFailed = true },
    settleDenied: (denied: CallToolResult): CallToolResult => settle(denied),
    publish: (result: CallToolResult): CallToolResult | Promise<CallToolResult> => {
      const refresh = refreshCertificate
      if (!refresh) return settle(result)
      return (async () => {
        await refresh()
        return settle(result) // No await after the final publication guard.
      })()
    },
    settleError: (error: unknown): CallToolResult => { rememberInputPolicy(error); return settle(errorResult(error)) }
  }
}

export type LabeledCreationSettlement = ReturnType<typeof labeledCreationSettlement>
