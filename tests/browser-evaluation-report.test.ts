import { describe, expect, it } from 'vitest'
import {
  BROWSER_EVALUATION_SCENARIOS,
  BROWSER_EVALUATION_MAX_REPORT_CHARS,
  buildBrowserEvaluationReport,
  type BrowserEvaluationObservation
} from '../scripts/browser-evaluation-report.js'

const observations: BrowserEvaluationObservation[] = [
  { scenarioId: 'navigation-drift', outcome: 'invalidated', contextStatus: 'navigation-changed', approvalStatus: 'not-required', toolResult: 'invalidated', dispatchStatus: 'not-dispatched', transportStatus: 'not-started', postconditionStatus: 'not-established', authoritativeReadback: 'not-performed', retryAllowed: false },
  { scenarioId: 'reconnect-drift', outcome: 'invalidated', contextStatus: 'control-changed', approvalStatus: 'not-required', toolResult: 'invalidated', dispatchStatus: 'not-dispatched', transportStatus: 'not-started', postconditionStatus: 'not-established', authoritativeReadback: 'not-performed', retryAllowed: false },
  { scenarioId: 'expired-authentication', outcome: 'reconciliation_required', contextStatus: 'signed-out', approvalStatus: 'not-required', toolResult: 'invalidated', dispatchStatus: 'not-dispatched', transportStatus: 'not-started', postconditionStatus: 'context-changed', authoritativeReadback: 'unavailable', retryAllowed: false },
  { scenarioId: 'blocked-human-takeover', outcome: 'blocked', contextStatus: 'matches', approvalStatus: 'expired', toolResult: 'blocked', dispatchStatus: 'not-dispatched', transportStatus: 'not-started', postconditionStatus: 'not-established', authoritativeReadback: 'not-performed', retryAllowed: false },
  { scenarioId: 'scheduler-cancel-before-dispatch', outcome: 'cancelled', contextStatus: 'matches', approvalStatus: 'not-required', toolResult: 'not-run', dispatchStatus: 'not-dispatched', transportStatus: 'not-started', postconditionStatus: 'not-established', authoritativeReadback: 'not-performed', retryAllowed: false },
  { scenarioId: 'flaky-read-response', outcome: 'recovered', contextStatus: 'matches', approvalStatus: 'not-required', toolResult: 'accepted', dispatchStatus: 'not-dispatched', transportStatus: 'succeeded', postconditionStatus: 'verified', authoritativeReadback: 'verified', retryAllowed: true },
  { scenarioId: 'ambiguous-write-response', outcome: 'reconciled', contextStatus: 'signed-out', approvalStatus: 'not-required', toolResult: 'unknown', dispatchStatus: 'dispatched-once', transportStatus: 'succeeded', postconditionStatus: 'not-verified', authoritativeReadback: 'verified', retryAllowed: false }
]

describe('privacy-safe browser evaluation report', () => {
  it('builds a deterministic bounded report with every pinned scenario', () => {
    const first = buildBrowserEvaluationReport('2.4.4', observations)
    const second = buildBrowserEvaluationReport('2.4.4', [...observations].reverse())

    expect(first).toEqual(second)
    expect(first.scenarios.map(scenario => scenario.scenarioId)).toEqual(BROWSER_EVALUATION_SCENARIOS)
    expect(first.scenarios).toEqual(expect.arrayContaining([
      expect.objectContaining({ scenarioId: 'navigation-drift', outcome: 'invalidated', retryAllowed: false }),
      expect.objectContaining({ scenarioId: 'scheduler-cancel-before-dispatch', outcome: 'cancelled', dispatch: 'not-dispatched', retryAllowed: false }),
      expect.objectContaining({ scenarioId: 'ambiguous-write-response', initialOutcome: 'reconciliation_required', outcome: 'reconciled', dispatch: 'dispatched-once', toolPostcondition: 'not-verified', authoritativeReadback: 'verified', retryAllowed: false })
    ]))
    expect(first.workflowOwnership).toEqual({
      triggerAndJobLifecycle: 'external-scheduler',
      planningAndDrafts: 'calling-agent',
      browserWorkspaceAndHumanTakeover: 'hronaut',
      authoritativeOutcome: 'target-system'
    })
    expect(first.scenarios.every(scenario => (
      scenario.triggerId !== scenario.logicalTaskId
      && scenario.logicalTaskId !== scenario.sessionId
      && scenario.sessionId !== scenario.actionAttemptId
      && scenario.schedulerAttempt === 1
    ))).toBe(true)
    expect(JSON.stringify(first).length).toBeLessThan(BROWSER_EVALUATION_MAX_REPORT_CHARS)
  })

  it('rejects missing, duplicate, or unpinned outcomes', () => {
    expect(() => buildBrowserEvaluationReport('2.4.4', observations.slice(1))).toThrow(/Missing/)
    expect(() => buildBrowserEvaluationReport('2.4.4', [...observations, observations[0]!])).toThrow(/Duplicate/)
    expect(() => buildBrowserEvaluationReport('2.4.4', observations.map(value => value.scenarioId === 'navigation-drift'
      ? { ...value, retryAllowed: true }
      : value))).toThrow(/pinned outcome/)
    expect(() => buildBrowserEvaluationReport(`2.4.4-${'x'.repeat(65)}`, observations)).toThrow(/semantic/)
  })

  it('cannot carry raw browser or customer fields', () => {
    const report = buildBrowserEvaluationReport('2.4.4', observations)
    const exported = JSON.stringify(report)

    for (const key of ['url', 'selector', 'cookie', 'credential', 'pageText', 'resumeKey', 'accountId']) {
      expect(Object.keys(report.scenarios[0]!)).not.toContain(key)
    }
    for (const secret of ['private-query-canary', 'customer@example.test', 'session-secret-canary']) {
      expect(exported).not.toContain(secret)
    }
  })
})
