// Result shapes shared by the MCP server and its tools.
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { createHash } from 'node:crypto'
import { type BrowserReconciliationCondition, type BrowserReconciliationResult, classifyBrowserReconciliation } from '../../shared/browser-reconciliation.js'
import type { BrowserState, McpActivityResult } from '../../shared/types.js'
import { NativeClickAdmissionError, type NativeClickProgress, nativeClickEffectsPossible, nativeClickReason } from '../browser/native-click-admission.js'
import { NativeInputCleanupError } from '../browser/native-input-cleanup.js'
import { NativeKeyHoldOutcomeUnknownError, type NativeKeyHoldProgress } from '../browser/native-key-hold.js'
import { NativeWheelOutcomeUnknownError } from '../browser/native-wheel.js'
import { McpCapabilityAuthorizationError } from './capability-profile-store.js'
import { type AdvertisedBrowserToolDefinition, BROWSER_TOOL_CATALOG } from './tool-catalog.js'
import { WorkspaceWriteLeaseError } from './workspace-write-leases.js'

export function toolDefinition(name: string): AdvertisedBrowserToolDefinition {
  const tool = BROWSER_TOOL_CATALOG.find((candidate) => candidate.name === name)
  if (!tool) throw new Error(`Unknown browser tool: ${name}`)
  return tool
}

export function toolDescription(name: string): string {
  return toolDefinition(name).description
}

export const textResult = (value: unknown): CallToolResult => ({
  content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }]
})

export const isTimeoutError = (error: unknown): boolean => error instanceof Error
  && (error.name === 'TimeoutError' || /(?:timed out|timeout)/iu.test(error.message))

export const nativeClickFailureResult = (progress: NativeClickProgress, reasonValue: unknown = 'CONTEXT_OR_INPUT_UNCERTAIN', reviewFinalizationFailed = false, policy?: Record<string, unknown>): CallToolResult => {
  const possible = nativeClickEffectsPossible(progress)
  const reason = nativeClickReason(reasonValue)
  const outcome = { ...(policy?.permission === 'denied' ? { permission: 'denied', policyDecision: policy.policyDecision } : {}), status: possible ? 'OUTCOME_UNKNOWN' : 'NOT_DISPATCHED', reason,
    effects: possible ? 'possible' : 'none', retrySafe: false,
    press: progress.downAttempted > 0 ? 'attempted' : 'not-dispatched', progress: { ...progress },
    ...(reason === 'TARGET_DISABLED' ? { message: 'Target is natively disabled.' } : {}),
    ...(reviewFinalizationFailed ? { reviewFinalization: 'failed' } : {}),
    nextAction: (reason === 'CLICK_STATE_UNCONFIRMED' || progress.targetCleanup === 'unconfirmed' || progress.inputCleanupFailed || progress.downAttempted > progress.upAcknowledged ? 'Close this tab before another semantic native click; retained handles or input cleanup could not be confirmed. ' : '') + 'Inspect fresh visible state before a new request. Preparatory scroll/hover and earlier presses are not rolled back. Press acknowledgements do not prove target routing or handler execution; do not replay automatically.' }
  return { ...textResult(outcome), structuredContent: outcome, isError: true }
}

export const nativeInputCleanupResult = (reviewFinalizationFailed = false): CallToolResult => {
  const outcome = {
    status: 'OUTCOME_UNKNOWN', reason: 'NATIVE_INPUT_CLEANUP_FAILED', retrySafe: false,
    effects: 'possible',
    ...(reviewFinalizationFailed ? { reviewFinalization: 'failed' } : {}),
    nextAction: 'Native input was dispatched and cleanup may be incomplete. Inspect the visible page and input state before continuing; do not automatically replay the action. Effects are not rolled back.'
      + (reviewFinalizationFailed ? ' Review finalization failed; its recorded state is not confirmed and must be reconciled before continuing.' : '')
  }
  return { ...textResult(outcome), structuredContent: outcome, isError: true }
}

export const selectionNotSubmittedResult = (result: CallToolResult): CallToolResult => {
  const outcome = { ...result.structuredContent, status: 'NOT_DISPATCHED', effects: 'none', retrySafe: false,
    dispatch: 'not-dispatched', postcondition: 'not-established', reconciliationRequired: false,
    nextAction: 'No selection was submitted. Inspect the rejection and obtain fresh authority before a new request.' }
  return { ...textResult(outcome), structuredContent: outcome, isError: true }
}

export const selectionUnknownResult = (reviewFinalizationFailed = false, policy?: Record<string, unknown>): CallToolResult => {
  const outcome = {
    status: 'OUTCOME_UNKNOWN', reason: 'SELECTION_UNCERTAIN', retrySafe: false, effects: 'possible',
    ...(policy?.permission ? { permission: policy.permission } : {}),
    ...(policy?.policyDecision ? { policyDecision: policy.policyDecision } : {}),
    ...(reviewFinalizationFailed ? { reviewFinalization: 'failed' } : {}),
    nextAction: 'Semantic selection was submitted; final state or authority could not be confirmed. Inspect fresh state before continuing; do not automatically replay.'
  }
  return { ...textResult(outcome), structuredContent: outcome, isError: true }
}

export const nativeWheelUnknownResult = (reviewFinalizationFailed = false): CallToolResult => {
  const outcome = {
    status: 'OUTCOME_UNKNOWN', reason: 'WHEEL_COMMAND_UNCERTAIN', retrySafe: false, effects: 'possible',
    ...(reviewFinalizationFailed ? { reviewFinalization: 'failed' } : {}),
    nextAction: 'Wheel dispatch was attempted; acknowledgement or final authority could not be confirmed. Inspect fresh page state before continuing; do not automatically replay.'
  }
  return { ...textResult(outcome), structuredContent: outcome, isError: true }
}

export const nativeKeyHoldUnknownResult = (progress: NativeKeyHoldProgress, reviewFinalizationFailed = false, policy?: Record<string, unknown>): CallToolResult => {
  const outcome = {
    status: 'OUTCOME_UNKNOWN', reason: 'KEY_HOLD_UNCERTAIN', retrySafe: false, effects: 'possible',
    down: progress.downAcknowledged ? 'ACKNOWLEDGED' : 'ATTEMPTED',
    release: progress.releaseAcknowledged ? 'ACKNOWLEDGED' : 'UNCONFIRMED',
    ...(reviewFinalizationFailed ? { reviewFinalization: 'failed' } : {}),
    ...(policy?.permission === 'denied' || policy?.policyDecision !== undefined ? { permission: 'denied', policyDecision: policy.policyDecision } : {}),
    nextAction: 'A key down was attempted. Inspect fresh state; never automatically replay. If release is unconfirmed, close this tab before another hold; navigation does not establish release.'
  }
  return { ...textResult(outcome), structuredContent: outcome, isError: true }
}

export const nativeKeyHoldNotDispatchedResult = (result: CallToolResult, policy?: Record<string, unknown>): CallToolResult => {
  const detail = result.structuredContent ? undefined : result.content.find(item => item.type === 'text')?.text.slice(0, 500)
  const outcome = { ...result.structuredContent, ...policy, status: 'NOT_DISPATCHED', reason: 'KEY_HOLD_NOT_DISPATCHED', effects: 'none', dispatch: 'not-dispatched', retrySafe: false,
    postcondition: 'not-established', reconciliationRequired: false, ...(detail ? { detail } : {}),
    nextAction: 'No key down was attempted. Inspect the rejection and obtain fresh authority before a new request.' }
  return { ...textResult(outcome), structuredContent: outcome, isError: true }
}

export const errorResult = (error: unknown): CallToolResult => {
  if (error instanceof NativeClickAdmissionError) return nativeClickFailureResult(error.progress, error.reason)
  if (error instanceof NativeKeyHoldOutcomeUnknownError) return nativeKeyHoldUnknownResult(error.progress)
  if (error instanceof NativeWheelOutcomeUnknownError) return nativeWheelUnknownResult()
  if (error instanceof NativeInputCleanupError) return nativeInputCleanupResult()
  if (error instanceof WorkspaceWriteLeaseError) {
    const outcome = {
      status: error.code === 'WORKSPACE_BUSY' ? 'BUSY' : 'LEASE_LOST',
      reason: error.code,
      leaseMode: 'exclusive-write',
      dispatch: 'not-dispatched',
      effects: 'none',
      retrySafe: error.code === 'WORKSPACE_BUSY',
      nextAction: error.code === 'WORKSPACE_BUSY'
        ? 'Inspect workspace ownership later or use a separate workspace. Do not retry the mutation blindly.'
        : 'Inspect current workspace state, claim a fresh write lease, and revalidate the target before issuing a new mutation.'
    }
    return { ...textResult(outcome), structuredContent: outcome, isError: true }
  }
  const policyDecision = error instanceof McpCapabilityAuthorizationError ? error.decision : undefined
  const message = policyDecision
    ? `MCP capability denied this operation: ${policyDecision.reasonCode} at ${policyDecision.firstDenyingRule}.`
    : error instanceof Error ? error.message : String(error)
  return {
    isError: true,
    content: [{ type: 'text', text: message }],
    ...(policyDecision ? {
      structuredContent: {
        status: 'POLICY_REJECTED',
        reason: policyDecision.reasonCode,
        policyDecision,
        dispatch: 'not-dispatched',
        effects: 'none',
        postcondition: 'not-established',
        reconciliationRequired: false
      }
    } : isTimeoutError(error) ? { structuredContent: { status: 'TIMED_OUT' } } : {})
  }
}

export function closedTabWaitResult(error: unknown, targetWasRemoved = false): CallToolResult | undefined {
  if (!(error instanceof Error)) return undefined
  const closedDuringManagerWait = error.message.startsWith('The tab closed while waiting')
  const removedDuringWrapperValidation = targetWasRemoved && (
    error.message.startsWith('Workspace is not authorized for this MCP client')
    || error.message.startsWith('Tab not found:')
  )
  if (!closedDuringManagerWait && !removedDuringWrapperValidation) return undefined
  const outcome = {
    status: 'STALE_OBSERVATION',
    retrySafe: false,
    nextAction: 'The waited-on tab closed. Inspect the current workspace and choose a live tab before waiting again.'
  }
  return { ...textResult(outcome), structuredContent: outcome, isError: true }
}

export function safeValue(value: unknown): unknown {
  try {
    return JSON.parse(JSON.stringify(value))
  } catch {
    return String(value)
  }
}

export function mcpWorkspaceTab<T extends { mcpGroupId?: string; mcpGroupName?: string; networkConditionState?: import('../../shared/types.js').BrowserNetworkConditionState }>(tab: T): Omit<T, 'mcpGroupId' | 'mcpGroupName' | 'networkConditionState'> & {
  networkConditionState?: { application: import('../../shared/types.js').BrowserNetworkConditionState['application']; retainedRuleCount: number }
  workspaceId?: string
  workspaceName?: string
} {
  const { mcpGroupId, mcpGroupName, networkConditionState, ...rest } = tab
  return {
    ...rest,
    ...(networkConditionState ? { networkConditionState: { application: networkConditionState.application, retainedRuleCount: networkConditionState.retainedRules.length } } : {}),
    ...(mcpGroupId ? { workspaceId: mcpGroupId } : {}),
    ...(mcpGroupName ? { workspaceName: mcpGroupName } : {})
  }
}

export function mcpWorkspaceState(state: BrowserState): Record<string, unknown> {
  const { tabs, closedTabs, mcpTabGroups, savedTabGroups, ...rest } = state
  return {
    ...rest,
    tabs: tabs.map(mcpWorkspaceTab),
    closedTabs: closedTabs.map(mcpWorkspaceTab),
    workspaces: mcpTabGroups,
    savedWorkspaces: savedTabGroups
  }
}

export type PublicBrowserReconciliation = BrowserReconciliationResult & {
  logicalItemFingerprint: string
  targetFingerprint: string
  sourceRevisionFingerprint: string
}

export function reconciliationFingerprint(kind: 'logical-item' | 'target' | 'source-revision', value: string): string {
  return createHash('sha256').update(`hronaut-reconciliation-${kind}-v1\0`).update(value, 'utf8').digest('hex')
}

export function publicBrowserReconciliation(
  input: { logicalItemKey: string; targetIdentity: string; sourceRevision: string; mode: BrowserReconciliationCondition['mode'] },
  evidence: import('../../shared/browser-reconciliation.js').BrowserReconciliationEvidence
): PublicBrowserReconciliation {
  return {
    ...classifyBrowserReconciliation(input.mode, evidence),
    logicalItemFingerprint: reconciliationFingerprint('logical-item', input.logicalItemKey),
    targetFingerprint: reconciliationFingerprint('target', input.targetIdentity),
    sourceRevisionFingerprint: reconciliationFingerprint('source-revision', input.sourceRevision)
  }
}

export function classifyMcpActivityResult(input: {
  readOnly: boolean
  dispatched: boolean
  cancelled: boolean
  timedOut: boolean
  threw: boolean
  isError: boolean
  status?: string
  invalidatedOutcome?: 'outcome-unknown' | 'stale-observation' | 'provenance-rejected'
  verificationStatus?: string
}): McpActivityResult {
  const base = {
    dispatch: input.dispatched ? 'dispatched' as const : 'not-dispatched' as const,
    evidenceSource: 'hronaut-observed' as const
  }
  const effects = (confirmed = false): McpActivityResult['effects'] => input.readOnly || !input.dispatched
    ? 'none' : confirmed ? 'confirmed' : 'possible'
  if (input.cancelled) return { ...base, outcome: 'cancelled', reasonCode: 'REQUEST_CANCELLED', effects: effects() }
  if (input.timedOut || input.status === 'TIMEOUT' || input.status === 'TIMED_OUT') {
    return { ...base, outcome: 'timed-out', reasonCode: 'TIMEOUT', effects: effects() }
  }
  if (input.invalidatedOutcome === 'provenance-rejected'
    || ['BLOCKED', 'POLICY_REJECTED', 'STALE_PRECONDITION', 'UNTRUSTED_TARGET'].includes(input.status ?? '')) {
    return { ...base, outcome: 'blocked', reasonCode: 'POLICY_REJECTED', effects: effects() }
  }
  if (input.invalidatedOutcome === 'outcome-unknown' || input.status === 'OUTCOME_UNKNOWN') {
    return { ...base, outcome: 'outcome-unknown', reasonCode: 'CONTEXT_CHANGED', effects: effects() }
  }
  if (input.invalidatedOutcome === 'stale-observation' || input.status === 'STALE_OBSERVATION') {
    return { ...base, outcome: 'interrupted', reasonCode: 'CONTEXT_CHANGED', effects: effects() }
  }
  if (input.verificationStatus && input.verificationStatus !== 'verified') {
    return { ...base, outcome: 'outcome-unknown', reasonCode: 'POSTCONDITION_NOT_VERIFIED', effects: effects() }
  }
  if (input.isError) return { ...base, outcome: 'failed', reasonCode: 'RESULT_ERROR', effects: effects() }
  if (input.threw) return { ...base, outcome: 'failed', reasonCode: 'COMMAND_FAILED', effects: effects() }
  return {
    ...base,
    outcome: 'succeeded',
    reasonCode: input.verificationStatus === 'verified' ? 'POSTCONDITION_VERIFIED' : 'COMPLETED',
    effects: effects(input.verificationStatus === 'verified')
  }
}
