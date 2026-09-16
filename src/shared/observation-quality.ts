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
  expectedOrigin?: string
  expectedTextProvided?: boolean
  expectedSelectorProvided?: boolean
}

export interface BrowserObservationQualityResult {
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
  const base = {
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
  if (challengeTitleAndControl || (signals.challengeSignals.length > 0 && shape.primaryTextChars < 160)) {
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
  expectedText?: string
  expectedSelector?: string
}): string {
  const expectedText = JSON.stringify(options.expectedText ?? null)
  const expectedSelector = JSON.stringify(options.expectedSelector ?? null)
  return `(() => {
    const expectedText = ${expectedText};
    const expectedSelector = ${expectedSelector};
    const compact = (value) => String(value || '').replace(/\\s+/g, ' ').trim().slice(0, 100000);
    const visible = (element) => {
      try {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
      } catch { return false; }
    };
    const bodyText = compact(document.body?.innerText || document.body?.textContent || '');
    const lowerBody = bodyText.toLocaleLowerCase('en-US');
    const title = compact(document.title).toLocaleLowerCase('en-US');
    const headings = [...document.querySelectorAll('h1,h2,h3,[role="heading"]')].filter(visible);
    const headingText = compact(headings.slice(0, 80).map((element) => element.innerText || element.textContent || '').join(' ')).toLocaleLowerCase('en-US');
    const primaryTextChars = Math.max(0, ...[...document.querySelectorAll('main,article,[role="main"]')]
      .filter(visible).slice(0, 40).map((element) => compact(element.innerText || element.textContent || '').length));
    const noiseTextChars = Math.min(100000, [...document.querySelectorAll('nav,header,footer,[role="navigation"],[role="dialog"],aside')]
      .filter(visible).slice(0, 80).reduce((total, element) => total + compact(element.innerText || element.textContent || '').length, 0));
    const interactiveCount = [...document.querySelectorAll('a[href],button,input,textarea,select,summary,[role="button"],[role="link"],[contenteditable="true"]')]
      .filter(visible).slice(0, 1001).length;
    const challengeSignals = [];
    if (/just a moment|attention required|checking your browser/.test(title)) challengeSignals.push('challenge-title');
    if (/verify (?:that )?you are human|complete (?:the )?captcha|checking your browser|enable javascript and cookies to continue/.test(lowerBody)) challengeSignals.push('human-verification');
    if (document.querySelector('.cf-turnstile,[id*="captcha" i],[class*="captcha" i],iframe[src*="captcha" i],iframe[src*="challenge" i]')) challengeSignals.push('challenge-control');
    const loginSignals = [];
    const passwordField = [...document.querySelectorAll('input[type="password"]')].some(visible);
    if (passwordField) loginSignals.push('password-field');
    if (/sign in to continue|login required|log in required|authentication required/.test(title + ' ' + headingText + ' ' + lowerBody.slice(0, 2000))) loginSignals.push('sign-in-copy');
    if (loginSignals.length === 1 && loginSignals[0] === 'password-field' && !/(sign in|log in|login|account)/.test(title + ' ' + headingText)) loginSignals.length = 0;
    const soft404Signals = [];
    if (/^(?:404\\b|page not found\\b|not found\\b)|\\b404\\s*[-|:]/.test(title)) soft404Signals.push('not-found-title');
    if (/^(?:404\\b|page not found\\b|not found\\b)|the requested page does not exist/.test(headingText + ' ' + lowerBody.slice(0, 2000))) soft404Signals.push('not-found-copy');
    const cookieSignals = [];
    if (/we use cookies|accept all cookies|cookie preferences|manage cookies/.test(lowerBody.slice(0, 5000))) cookieSignals.push('cookie-consent');
    let expectedSelectorMatched;
    if (expectedSelector !== null) {
      try {
        const element = document.querySelector(expectedSelector);
        expectedSelectorMatched = Boolean(element && visible(element));
      } catch { expectedSelectorMatched = false; }
    }
    return {
      resolvedUrl: location.href,
      contentType: String(document.contentType || '').slice(0, 128),
      visibleTextChars: bodyText.length,
      primaryTextChars,
      noiseTextChars,
      headingCount: Math.min(1000, headings.length),
      interactiveCount: Math.min(1000, interactiveCount),
      challengeSignals,
      loginSignals,
      soft404Signals,
      cookieSignals,
      ...(expectedText === null ? {} : { expectedTextMatched: lowerBody.includes(compact(expectedText).toLocaleLowerCase('en-US')) }),
      ...(expectedSelector === null ? {} : { expectedSelectorMatched })
    };
  })()`
}
