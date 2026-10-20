import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { EMULATION_INPUT_ERRORS, EmulationInputError } from '../../browser/emulation-state.js'
import { isNetworkRouteRefusal } from '../../browser/network-route-input.js'
import { McpCapabilityAuthorizationError } from '../capability-profile-store.js'
import { errorResult, textResult } from '../tool-results.js'
import type { ToolActivityClassification } from './tool-context.js'

/** The longest refusal message an agent reads; a refusal can quote a header name or rule ID the agent sent. */
const MAX_REFUSAL_MESSAGE = 500

function boundedRefusal(message: string): string {
  return message.length > MAX_REFUSAL_MESSAGE ? `${message.slice(0, MAX_REFUSAL_MESSAGE - 1)}…` : message
}

/**
 * How browser_emulate and browser_network_routes settle a call. Before the first configuration command a failure
 * reports that nothing was dispatched; after it, that application is unknown. A result is published only after the
 * tool's own publication check, and the tab activity waits for the settled result. A read-only call's error stays as
 * it is. A request condition refused before anything was sent keeps its message, which says what to change.
 */
export function requestConditionsSettlement(emulation: boolean, input: Record<string, unknown>, readOnly = false) {
  let attempted = false
  let policy: Record<string, unknown> | undefined
  let emulationInputError: keyof typeof EMULATION_INPUT_ERRORS | undefined
  let routeRefusal: Error | undefined
  let reviewFinalizationFailed = false
  let publication: (() => void) | undefined
  let finishActivity: ((result: CallToolResult) => void) | undefined
  let finishing = false
  const rememberInputPolicy = (error: unknown): void => {
    if (!attempted && error instanceof EmulationInputError) emulationInputError = error.reason
    // The failure a call ends with explains it, so any later failure replaces an earlier refusal.
    if (!emulation) routeRefusal = !attempted && isNetworkRouteRefusal(error) ? error : undefined
    if (error instanceof McpCapabilityAuthorizationError) policy = { permission: 'denied', policyDecision: error.decision }
  }
  const settle = (result: CallToolResult): CallToolResult => {
    let settled = result
    if (result.isError && !readOnly && (emulation || input.action !== undefined)) {
      const refusal = routeRefusal && !attempted && !policy && !reviewFinalizationFailed && result.structuredContent?.permission !== 'denied'
        ? boundedRefusal(routeRefusal.message) : undefined
      const outcome = { ...result.structuredContent, ...policy,
        ...(reviewFinalizationFailed ? { reviewFinalization: 'failed' } : {}),
        ...(emulation && !attempted && !policy && !reviewFinalizationFailed && result.structuredContent?.permission !== 'denied' && emulationInputError
          ? { reason: emulationInputError, message: EMULATION_INPUT_ERRORS[emulationInputError] } : {}),
        ...(refusal !== undefined ? { message: refusal } : {}),
        status: attempted ? 'OUTCOME_UNKNOWN' : 'NOT_DISPATCHED',
        effects: attempted ? 'possible' : 'none', retrySafe: false,
        nextAction: result.structuredContent?.nextAction ?? (attempted
          ? (emulation ? 'Read current emulation health. Restore retained settings explicitly only if application is unknown; do not replay the failed request. Network uncertainty requires separate recovery.' : 'Inspect current application health before explicitly clearing conditions; do not automatically replay.')
          : refusal !== undefined
            ? 'No configuration command was submitted. Change the request as message says before sending it again.'
            : 'No configuration command was submitted. Inspect current authority and application health before proceeding.') }
      settled = { ...textResult(outcome), structuredContent: outcome, isError: true }
    }
    finishActivity?.(settled)
    return settled
  }
  return {
    markSubmitted: (): void => { attempted = true },
    retainPublication: (check: () => void): void => { publication = check },
    rememberInputPolicy,
    reviewFinalizationFailed: (): void => { if (attempted || emulationInputError || routeRefusal !== undefined) reviewFinalizationFailed = true },
    deferActivity: (finish: (result: CallToolResult) => void): boolean => {
      if (finishing) return false
      finishActivity = settled => { finishing = true; finish(settled) }
      return true
    },
    settleDenied: (denied: CallToolResult): CallToolResult => settle(denied),
    publish: (result: CallToolResult): CallToolResult | undefined => {
      if (emulation) {
        if (!result.isError) {
          if (!publication) throw new Error('Emulation publication guard is unavailable')
          publication()
        }
        return settle(result)
      }
      if (!publication) return undefined
      publication()
      return settle(result) // Publication checks never rewrite main-owned native health.
    },
    settleError: (error: unknown): CallToolResult => { rememberInputPolicy(error); return settle(errorResult(error)) },
    classifyActivity: (activity: ToolActivityClassification, failed: boolean): ToolActivityClassification => ({
      ...activity,
      dispatched: attempted,
      invalidatedOutcome: attempted && failed ? 'outcome-unknown' : activity.invalidatedOutcome
    })
  }
}

export type RequestConditionsSettlement = ReturnType<typeof requestConditionsSettlement>
