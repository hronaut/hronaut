import { pageScript } from './page-script.js'
import { observationSignalsInPage } from './observation-quality.page.js'

export type BrowserObservationQualityStatus =
  | 'candidate'
  | 'empty_content'
  | 'login_wall'
  | 'challenge'
  | 'soft_404'
  | 'wrong_origin'
  | 'needs_review'
  | 'unknown'

export type BrowserObservationQualityDecision = 'continue' | 'stop' | 'review'

export type BrowserObservationQualityEvidenceClass =
  | 'expected_marker'
  | 'expected_marker_missing'
  | 'semantic_content'
  | 'empty_document'
  | 'authentication_gate'
  | 'automated_challenge'
  | 'missing_page'
  | 'origin_mismatch'
  | 'structural_noise'
  | 'ambiguous_content'
  | 'unsupported_content'

export interface BrowserObservationQualitySignals {
  resolvedUrl: string
  contentType: string
  pageState?: 'ready' | 'loading' | 'unavailable'
  visibleTextChars: number
  primaryTextChars: number
  noiseTextChars: number
  headingCount: number
  interactiveCount: number
  challengeSignals: string[]
  loginSignals: string[]
  soft404Signals: string[]
  cookieSignals: string[]
  expectedTextMatched?: boolean
  expectedSelectorMatched?: boolean
}

export interface BrowserObservationQualityOptions {
  challengeDetectionEnabled?: boolean
  expectedOrigin?: string
  expectedTextProvided?: boolean
  expectedSelectorProvided?: boolean
}

export interface BrowserObservationQualityResult {
  challengeDetectionEnabled: boolean
  status: BrowserObservationQualityStatus
  decision: BrowserObservationQualityDecision
  evidenceClass: BrowserObservationQualityEvidenceClass
  reason: string
  resolvedUrl: string
  resolvedOrigin: string | null
  contentType: string
  expectedEvidence: {
    provided: boolean
    matched: boolean | null
    textProvided: boolean
    selectorProvided: boolean
  }
  shape: {
    visibleTextChars: number
    primaryTextChars: number
    noiseTextChars: number
    headingCount: number
    interactiveCount: number
  }
  /** Present when the person chose to keep URL query strings and fragments from agents: resolvedUrl is origin and path only. */
  urlDetail?: 'omitted'
}

const boundedCount = (value: number): number => Number.isFinite(value)
  ? Math.min(100_000, Math.max(0, Math.trunc(value)))
  : 0

function parsedOrigin(value: string): string | null {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.origin : null
  } catch {
    return null
  }
}

export function normalizeObservationExpectedOrigin(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  const origin = parsedOrigin(value)
  if (!origin) throw new TypeError('expectedOrigin must be an HTTP or HTTPS URL')
  return origin
}

export function classifyBrowserObservationQuality(
  signals: BrowserObservationQualitySignals,
  options: BrowserObservationQualityOptions
): BrowserObservationQualityResult {
  const resolvedOrigin = parsedOrigin(signals.resolvedUrl)
  const expectedOrigin = normalizeObservationExpectedOrigin(options.expectedOrigin)
  const textProvided = options.expectedTextProvided === true
  const selectorProvided = options.expectedSelectorProvided === true
  const markerProvided = textProvided || selectorProvided
  const pageUnavailable = signals.pageState === 'loading' || signals.pageState === 'unavailable'
  const markerMatched = markerProvided && !pageUnavailable
    ? (!textProvided || signals.expectedTextMatched === true)
      && (!selectorProvided || signals.expectedSelectorMatched === true)
    : null
  const shape = {
    visibleTextChars: boundedCount(signals.visibleTextChars),
    primaryTextChars: boundedCount(signals.primaryTextChars),
    noiseTextChars: boundedCount(signals.noiseTextChars),
    headingCount: boundedCount(signals.headingCount),
    interactiveCount: boundedCount(signals.interactiveCount)
  }
  const challengeDetectionEnabled = options.challengeDetectionEnabled === true
  const base = {
    challengeDetectionEnabled,
    resolvedUrl: signals.resolvedUrl,
    resolvedOrigin,
    contentType: signals.contentType.slice(0, 128),
    expectedEvidence: {
      provided: markerProvided,
      matched: markerMatched,
      textProvided,
      selectorProvided
    },
    shape
  }
  const result = (
    status: BrowserObservationQualityStatus,
    decision: BrowserObservationQualityDecision,
    evidenceClass: BrowserObservationQualityEvidenceClass,
    reason: string
  ): BrowserObservationQualityResult => ({ status, decision, evidenceClass, reason, ...base })

  if (expectedOrigin && resolvedOrigin !== expectedOrigin) {
    return result('wrong_origin', 'stop', 'origin_mismatch', 'The resolved page origin does not match the required origin.')
  }
  if (pageUnavailable) {
    return result('unknown', 'stop', 'ambiguous_content', signals.pageState === 'loading'
      ? 'The main document is still loading; assess it again after the page settles.'
      : 'The page renderer or navigation is unavailable; recover it before assessing content.')
  }
  const challengeTitleAndControl = signals.challengeSignals.includes('challenge-title')
    && signals.challengeSignals.includes('challenge-control')
  if (challengeDetectionEnabled && (challengeTitleAndControl || (signals.challengeSignals.length > 0 && shape.primaryTextChars < 160))) {
    return result('challenge', 'stop', 'automated_challenge', 'The page contains an automated-access or human-verification challenge.')
  }
  const passwordGate = signals.loginSignals.includes('password-field')
  if (passwordGate || (signals.loginSignals.length > 0 && shape.primaryTextChars < 160)) {
    return result('login_wall', 'stop', 'authentication_gate', 'The page is an authentication gate rather than the requested content.')
  }
  if (signals.soft404Signals.length > 0) {
    return result('soft_404', 'stop', 'missing_page', 'The rendered page reports missing content even though navigation completed.')
  }
  if (shape.visibleTextChars < 40 && shape.primaryTextChars === 0 && shape.interactiveCount === 0) {
    return result('empty_content', 'stop', 'empty_document', 'The rendered document has no meaningful visible content.')
  }
  if (markerProvided && markerMatched !== true) {
    return result('needs_review', 'stop', 'expected_marker_missing', 'Required task evidence is absent from the rendered page.')
  }
  if (markerMatched === true) {
    return result('candidate', 'continue', 'expected_marker', 'The rendered page contains every required task marker.')
  }
  const noiseRatio = shape.visibleTextChars > 0 ? shape.noiseTextChars / shape.visibleTextChars : 0
  if (
    (signals.cookieSignals.length > 0 && shape.primaryTextChars < 120)
    || (shape.noiseTextChars >= 120 && noiseRatio >= 0.65 && shape.primaryTextChars < 160)
  ) {
    return result('needs_review', 'review', 'structural_noise', 'Navigation, consent, or other structural text dominates the rendered content.')
  }
  if (shape.primaryTextChars >= 120 && shape.headingCount > 0) {
    return result('candidate', 'continue', 'semantic_content', 'The page has a meaningful primary-content region and heading structure.')
  }
  if (signals.contentType && !/^(?:text\/html|application\/xhtml\+xml)(?:\s*;|$)/iu.test(signals.contentType)) {
    return result('unknown', 'review', 'unsupported_content', 'This content type cannot be assessed from the rendered document shape.')
  }
  return result('needs_review', 'review', 'ambiguous_content', 'The page loaded, but its bounded structure does not establish useful task content.')
}

export function observationQualityPageScript(options: {
  challengeDetectionEnabled?: boolean
  expectedText?: string
  expectedSelector?: string
}): string {
  return pageScript(observationSignalsInPage, options.expectedText ?? null, options.expectedSelector ?? null, options.challengeDetectionEnabled === true)
}
