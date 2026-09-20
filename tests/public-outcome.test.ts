import { describe, expect, it } from 'vitest'
import type { BrowserObservationQualityResult } from '../src/shared/observation-quality.js'
import {
  classifyPublicObservationOutcome,
  classifyWriterContextOutcome,
  summarizePublicOutcomeAssessment
} from '../src/shared/public-outcome.js'

function assessment(
  status: BrowserObservationQualityResult['status'],
  matched: boolean | null,
  evidenceClass: BrowserObservationQualityResult['evidenceClass'] = 'expected_marker'
): BrowserObservationQualityResult {
  return {
    status,
    decision: status === 'candidate' ? 'continue' : 'stop',
    evidenceClass,
    reason: 'private diagnostic reason',
    resolvedUrl: 'https://user:secret@example.test/private?token=secret',
    resolvedOrigin: 'https://example.test',
    contentType: 'text/html',
    expectedEvidence: {
      provided: true,
      matched,
      textProvided: true,
      selectorProvided: false
    },
    shape: {
      visibleTextChars: 100,
      primaryTextChars: 100,
      noiseTextChars: 0,
      headingCount: 1,
      interactiveCount: 0
    }
  }
}

describe('public outcome classification', () => {
  it('requires the independent observer marker before reporting a public outcome', () => {
    expect(classifyWriterContextOutcome(assessment('candidate', true))).toBe('writer_context_verified')
    expect(classifyPublicObservationOutcome(assessment('candidate', true))).toBe('publicly_observed')
    expect(classifyPublicObservationOutcome(
      assessment('needs_review', false, 'expected_marker_missing')
    )).toBe('not_publicly_observed')
  })

  it.each([
    ['empty_content', 'empty_document'],
    ['soft_404', 'missing_page']
  ] as const)('treats %s as independently absent', (status, evidenceClass) => {
    expect(classifyWriterContextOutcome(assessment(status, false, evidenceClass)))
      .toBe('writer_context_not_verified')
    expect(classifyPublicObservationOutcome(assessment(status, false, evidenceClass)))
      .toBe('not_publicly_observed')
  })

  it.each([
    ['login_wall', 'authentication_gate'],
    ['challenge', 'automated_challenge'],
    ['unknown', 'ambiguous_content']
  ] as const)('keeps %s observations unknown', (status, evidenceClass) => {
    expect(classifyWriterContextOutcome(assessment(status, false, evidenceClass))).toBe('unknown')
    expect(classifyPublicObservationOutcome(assessment(status, false, evidenceClass))).toBe('unknown')
  })

  it('requires reconciliation for target mismatch or context drift', () => {
    expect(classifyPublicObservationOutcome(assessment('wrong_origin', false, 'origin_mismatch')))
      .toBe('reconciliation_required')
    expect(classifyPublicObservationOutcome(assessment('candidate', true), false))
      .toBe('reconciliation_required')
  })

  it('exports only the privacy-bounded assessment fields', () => {
    const summary = summarizePublicOutcomeAssessment(assessment('candidate', true))

    expect(summary).toEqual({
      status: 'candidate',
      evidenceClass: 'expected_marker',
      expectedEvidence: { provided: true, matched: true, textProvided: true, selectorProvided: false }
    })
    expect(JSON.stringify(summary)).not.toMatch(/secret|private|resolved|reason|content/i)
  })
})
