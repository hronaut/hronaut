import { describe, expect, it } from 'vitest'
import {
  classifyBrowserObservationQuality,
  type BrowserObservationQualitySignals
} from '../src/shared/observation-quality.js'

const signals = (overrides: Partial<BrowserObservationQualitySignals> = {}): BrowserObservationQualitySignals => ({
  resolvedUrl: 'https://example.test/article',
  contentType: 'text/html',
  visibleTextChars: 480,
  primaryTextChars: 360,
  noiseTextChars: 40,
  headingCount: 1,
  interactiveCount: 2,
  challengeSignals: [],
  loginSignals: [],
  soft404Signals: [],
  cookieSignals: [],
  expectedTextMatched: undefined,
  expectedSelectorMatched: undefined,
  ...overrides
})

describe('browser observation quality', () => {
  it.each([
    ['empty_content', signals({ visibleTextChars: 0, primaryTextChars: 0, noiseTextChars: 0, headingCount: 0, interactiveCount: 0 })],
    ['login_wall', signals({ loginSignals: ['password-field', 'sign-in-copy'] })],
    ['challenge', signals({ primaryTextChars: 30, challengeSignals: ['human-verification'] })],
    ['soft_404', signals({ soft404Signals: ['not-found-title'] })],
    ['needs_review', signals({ visibleTextChars: 360, primaryTextChars: 20, noiseTextChars: 320, headingCount: 0, interactiveCount: 18, cookieSignals: ['cookie-consent'] })]
  ] as const)('classifies %s without treating readable text as proof', (status, input) => {
    expect(classifyBrowserObservationQuality(input, {})).toMatchObject({ status, decision: status === 'needs_review' ? 'review' : 'stop' })
  })

  it('requires every caller-provided task marker before returning candidate', () => {
    expect(classifyBrowserObservationQuality(signals({ expectedTextMatched: false }), { expectedTextProvided: true }))
      .toMatchObject({ status: 'needs_review', decision: 'stop', evidenceClass: 'expected_marker_missing' })
    expect(classifyBrowserObservationQuality(signals({ expectedTextMatched: true }), { expectedTextProvided: true }))
      .toMatchObject({ status: 'candidate', decision: 'continue', evidenceClass: 'expected_marker' })
    expect(classifyBrowserObservationQuality(signals({ expectedTextMatched: true, expectedSelectorMatched: false }), {
      expectedTextProvided: true,
      expectedSelectorProvided: true
    })).toMatchObject({ status: 'needs_review', decision: 'stop', evidenceClass: 'expected_marker_missing' })
    expect(classifyBrowserObservationQuality(signals({ expectedTextMatched: true, expectedSelectorMatched: true }), {
      expectedTextProvided: true,
      expectedSelectorProvided: true
    })).toMatchObject({ status: 'candidate', decision: 'continue', evidenceClass: 'expected_marker' })
  })

  it('stops on an unexpected origin before considering useful content or markers', () => {
    expect(classifyBrowserObservationQuality(signals({ expectedTextMatched: true }), {
      expectedOrigin: 'https://other.example',
      expectedTextProvided: true
    })).toMatchObject({ status: 'wrong_origin', decision: 'stop', evidenceClass: 'origin_mismatch' })
  })

  it('keeps loading and unavailable pages unknown instead of treating them as empty', () => {
    for (const pageState of ['loading', 'unavailable'] as const) {
      expect(classifyBrowserObservationQuality(signals({ pageState }), {}))
        .toMatchObject({ status: 'unknown', decision: 'stop', evidenceClass: 'ambiguous_content' })
    }
  })

  it('does not mistake an article discussing login or challenge copy for a gate', () => {
    expect(classifyBrowserObservationQuality(signals({ challengeSignals: ['human-verification'] }), {}))
      .toMatchObject({ status: 'candidate', evidenceClass: 'semantic_content' })
    expect(classifyBrowserObservationQuality(signals({ loginSignals: ['sign-in-copy'] }), {}))
      .toMatchObject({ status: 'candidate', evidenceClass: 'semantic_content' })
  })

  it('returns only bounded evidence metadata for useful content', () => {
    const result = classifyBrowserObservationQuality(signals(), {})
    expect(result).toMatchObject({
      status: 'candidate',
      decision: 'continue',
      evidenceClass: 'semantic_content',
      resolvedOrigin: 'https://example.test'
    })
    expect(JSON.stringify(result)).not.toContain('article body')
  })
})
