import { createHash } from 'node:crypto'

export const BROWSER_EVALUATION_SCHEMA_VERSION = '1.1'
export const BROWSER_EVALUATION_FIXTURE_VERSION = '1.0.0'
export const BROWSER_EVALUATION_CLIENT_VERSION = '1.0.0'
export const BROWSER_EVALUATION_MAX_REPORT_CHARS = 10_000

export const BROWSER_EVALUATION_SCENARIOS = [
  'navigation-drift',
  'reconnect-drift',
  'expired-authentication',
  'blocked-human-takeover',
  'scheduler-cancel-before-dispatch',
  'flaky-read-response',
  'ambiguous-write-response'
] as const

export type BrowserEvaluationScenarioId = typeof BROWSER_EVALUATION_SCENARIOS[number]
export type BrowserEvaluationOutcome = 'invalidated' | 'blocked' | 'cancelled' | 'recovered' | 'reconciled' | 'reconciliation_required'
export type BrowserEvaluationContextStatus = 'matches' | 'navigation-changed' | 'control-changed' | 'signed-out' | 'unavailable'
export type BrowserEvaluationApprovalStatus = 'not-required' | 'waiting' | 'expired' | 'invalidated'
export type BrowserEvaluationToolResult = 'not-run' | 'accepted' | 'invalidated' | 'blocked' | 'unknown'
export type BrowserEvaluationDispatchStatus = 'not-dispatched' | 'dispatched-once'
export type BrowserEvaluationTransportStatus = 'not-started' | 'failed' | 'succeeded' | 'ambiguous'
export type BrowserEvaluationPostconditionStatus = 'not-established' | 'not-verified' | 'verified' | 'context-changed'
export type BrowserEvaluationReadbackStatus = 'not-performed' | 'verified' | 'unavailable'

export interface BrowserEvaluationObservation {
  scenarioId: BrowserEvaluationScenarioId
  outcome: BrowserEvaluationOutcome
  contextStatus: BrowserEvaluationContextStatus
  approvalStatus: BrowserEvaluationApprovalStatus
  toolResult: BrowserEvaluationToolResult
  dispatchStatus: BrowserEvaluationDispatchStatus
  transportStatus: BrowserEvaluationTransportStatus
  postconditionStatus: BrowserEvaluationPostconditionStatus
  authoritativeReadback: BrowserEvaluationReadbackStatus
  retryAllowed: boolean
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function fixtureUuid(value: string): string {
  const hash = digest(value)
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`
}

function expectedObservation(id: BrowserEvaluationScenarioId): Omit<BrowserEvaluationObservation, 'scenarioId'> {
  if (id === 'navigation-drift') return {
    outcome: 'invalidated', contextStatus: 'navigation-changed', approvalStatus: 'not-required',
    toolResult: 'invalidated', dispatchStatus: 'not-dispatched', transportStatus: 'not-started',
    postconditionStatus: 'not-established', authoritativeReadback: 'not-performed', retryAllowed: false
  }
  if (id === 'reconnect-drift') return {
    outcome: 'invalidated', contextStatus: 'control-changed', approvalStatus: 'not-required',
    toolResult: 'invalidated', dispatchStatus: 'not-dispatched', transportStatus: 'not-started',
    postconditionStatus: 'not-established', authoritativeReadback: 'not-performed', retryAllowed: false
  }
  if (id === 'expired-authentication') return {
    outcome: 'reconciliation_required', contextStatus: 'signed-out', approvalStatus: 'not-required',
    toolResult: 'invalidated', dispatchStatus: 'not-dispatched', transportStatus: 'not-started',
    postconditionStatus: 'context-changed', authoritativeReadback: 'unavailable', retryAllowed: false
  }
  if (id === 'blocked-human-takeover') return {
    outcome: 'blocked', contextStatus: 'matches', approvalStatus: 'expired',
    toolResult: 'blocked', dispatchStatus: 'not-dispatched', transportStatus: 'not-started',
    postconditionStatus: 'not-established', authoritativeReadback: 'not-performed', retryAllowed: false
  }
  if (id === 'scheduler-cancel-before-dispatch') return {
    outcome: 'cancelled', contextStatus: 'matches', approvalStatus: 'not-required',
    toolResult: 'not-run', dispatchStatus: 'not-dispatched', transportStatus: 'not-started',
    postconditionStatus: 'not-established', authoritativeReadback: 'not-performed', retryAllowed: false
  }
  if (id === 'flaky-read-response') return {
    outcome: 'recovered', contextStatus: 'matches', approvalStatus: 'not-required',
    toolResult: 'accepted', dispatchStatus: 'not-dispatched', transportStatus: 'succeeded',
    postconditionStatus: 'verified', authoritativeReadback: 'verified', retryAllowed: true
  }
  return {
    outcome: 'reconciled', contextStatus: 'signed-out', approvalStatus: 'not-required', toolResult: 'unknown',
    dispatchStatus: 'dispatched-once', transportStatus: 'succeeded', postconditionStatus: 'not-verified',
    authoritativeReadback: 'verified', retryAllowed: false
  }
}

export function buildBrowserEvaluationReport(hronautVersion: string, observations: BrowserEvaluationObservation[]) {
  if (hronautVersion.length > 64 || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u.test(hronautVersion)) {
    throw new TypeError('Browser evaluation requires a semantic Hronaut version')
  }
  const byId = new Map<BrowserEvaluationScenarioId, BrowserEvaluationObservation>()
  for (const observation of observations) {
    if (byId.has(observation.scenarioId)) throw new TypeError(`Duplicate browser evaluation scenario: ${observation.scenarioId}`)
    const expected = expectedObservation(observation.scenarioId)
    if (Object.entries(expected).some(([key, value]) => observation[key as keyof BrowserEvaluationObservation] !== value)) {
      throw new Error(`Browser evaluation scenario did not reach its pinned outcome: ${observation.scenarioId}`)
    }
    byId.set(observation.scenarioId, structuredClone(observation))
  }
  const missing = BROWSER_EVALUATION_SCENARIOS.filter(id => !byId.has(id))
  if (missing.length) throw new TypeError(`Missing browser evaluation scenarios: ${missing.join(', ')}`)

  const versionBinding = JSON.stringify({
    schemaVersion: BROWSER_EVALUATION_SCHEMA_VERSION,
    fixtureVersion: BROWSER_EVALUATION_FIXTURE_VERSION,
    clientVersion: BROWSER_EVALUATION_CLIENT_VERSION,
    hronautVersion
  })
  const report = {
    schemaVersion: BROWSER_EVALUATION_SCHEMA_VERSION,
    kind: 'hronaut-local-browser-evaluation',
    localOnly: true,
    versions: {
      fixture: BROWSER_EVALUATION_FIXTURE_VERSION,
      client: BROWSER_EVALUATION_CLIENT_VERSION,
      hronaut: hronautVersion
    },
    scenarioSetFingerprint: digest(`${versionBinding}\0${BROWSER_EVALUATION_SCENARIOS.join('\0')}`),
    privacy: {
      syntheticDataOnly: true,
      includesCredentials: false,
      includesCookies: false,
      includesRawUrls: false,
      includesSelectors: false,
      includesPageContent: false,
      includesLiveAccountIdentifiers: false
    },
    workflowOwnership: {
      triggerAndJobLifecycle: 'external-scheduler',
      planningAndDrafts: 'calling-agent',
      browserWorkspaceAndHumanTakeover: 'hronaut',
      authoritativeOutcome: 'target-system'
    },
    lifecycleRules: {
      cancellation: 'cancel-before-dispatch-or-reconcile-possible-effects',
      retry: 'fresh-context-and-authoritative-readback-required',
      completion: 'transport-acknowledgement-is-not-authoritative-outcome'
    },
    contextVocabulary: {
      workspace: 'synthetic-evaluation-workspace',
      profile: 'scratch-profile',
      account: 'synthetic-account',
      origin: 'loopback-fixture',
      tab: 'scenario-tab'
    },
    scenarios: BROWSER_EVALUATION_SCENARIOS.map((scenarioId) => {
      const observation = byId.get(scenarioId)!
      const scenarioVersion = '1.0.0'
      return {
        scenarioId,
        scenarioVersion,
        triggerId: fixtureUuid(`trigger\0${scenarioId}\0${scenarioVersion}`),
        logicalTaskId: fixtureUuid(`task\0${scenarioId}\0${scenarioVersion}`),
        sessionId: fixtureUuid(`session\0${scenarioId}\0${scenarioVersion}`),
        actionAttemptId: fixtureUuid(`attempt\0${scenarioId}\0${scenarioVersion}`),
        schedulerAttempt: 1,
        expectedContext: 'synthetic-evaluation-workspace/scratch-profile/synthetic-account/loopback-fixture/scenario-tab',
        observedContext: observation.contextStatus,
        capabilityTransition: observation.outcome === 'invalidated' ? 'invalidated' : 'unchanged',
        approvalTransition: observation.approvalStatus,
        toolResult: observation.toolResult,
        dispatch: observation.dispatchStatus,
        transport: observation.transportStatus,
        toolPostcondition: observation.postconditionStatus,
        initialOutcome: scenarioId === 'ambiguous-write-response' ? 'reconciliation_required' : observation.outcome,
        authoritativeReadback: observation.authoritativeReadback,
        outcome: observation.outcome,
        retryAllowed: observation.retryAllowed,
        nextAction: observation.outcome === 'reconciliation_required'
          ? 'read-authoritative-fixture-state-before-any-retry'
          : observation.outcome === 'invalidated'
            ? 'capture-fresh-context-before-continuing'
            : observation.outcome === 'blocked'
              ? 'obtain-a-fresh-human-decision'
              : 'continue-with-read-only-fixture-observation'
      }
    })
  }
  if (JSON.stringify(report).length >= BROWSER_EVALUATION_MAX_REPORT_CHARS) {
    throw new RangeError('Browser evaluation report exceeds its fixed size limit')
  }
  return report
}
