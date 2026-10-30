import type { BrowserObservationQualitySignals } from './observation-quality.js'

/**
 * Runs in the page: bounded counts and signals of the rendered document's shape, which main classifies. Challenge
 * signals are read only when challenge detection is on; a null expected text or selector is not checked.
 */
export function observationSignalsInPage(
  expectedText: string | null,
  expectedSelector: string | null,
  challengeDetectionEnabled: boolean
): BrowserObservationQualitySignals {
  const compact = (value: unknown): string => String(value || '').replace(/\s+/g, ' ').trim().slice(0, 100000)
  const visible = (element: Element): boolean => {
    try {
      const style = getComputedStyle(element)
      const rect = element.getBoundingClientRect()
      return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0
    } catch { return false }
  }
  const bodyText = compact(document.body?.innerText || document.body?.textContent || '')
  const lowerBody = bodyText.toLocaleLowerCase('en-US')
  const title = compact(document.title).toLocaleLowerCase('en-US')
  const headings = [...document.querySelectorAll<HTMLElement>('h1,h2,h3,[role="heading"]')].filter(visible)
  const headingText = compact(headings.slice(0, 80).map((element) => element.innerText || element.textContent || '').join(' ')).toLocaleLowerCase('en-US')
  const primaryTextChars = Math.max(0, ...[...document.querySelectorAll<HTMLElement>('main,article,[role="main"]')]
    .filter(visible).slice(0, 40).map((element) => compact(element.innerText || element.textContent || '').length))
  const noiseTextChars = Math.min(100000, [...document.querySelectorAll<HTMLElement>('nav,header,footer,[role="navigation"],[role="dialog"],aside')]
    .filter(visible).slice(0, 80).reduce((total, element) => total + compact(element.innerText || element.textContent || '').length, 0))
  const interactiveCount = [...document.querySelectorAll('a[href],button,input,textarea,select,summary,[role="button"],[role="link"],[contenteditable="true"]')]
    .filter(visible).slice(0, 1001).length
  const challengeSignals: string[] = []
  if (challengeDetectionEnabled) {
    // Check the rendered control and its ancestors, including transparent and
    // clipped background widgets. Do not change the other quality heuristics.
    const challengeVisible = (element: Element, rect: DOMRectReadOnly = element.getBoundingClientRect()): boolean => {
      if (!visible(element)) return false
      let left = rect.left, right = rect.right, top = rect.top, bottom = rect.bottom
      for (let node: Element | null = element; node; node = node.parentElement) {
        const style = getComputedStyle(node)
        if (style.display === 'none' || style.contentVisibility === 'hidden' || Number(style.opacity) === 0) return false
        const bounds = node.getBoundingClientRect()
        if (/hidden|clip|scroll|auto/.test(style.overflowX)) {
          left = Math.max(left, bounds.left); right = Math.min(right, bounds.right)
        }
        if (/hidden|clip|scroll|auto/.test(style.overflowY)) {
          top = Math.max(top, bounds.top); bottom = Math.min(bottom, bounds.bottom)
        }
        if (right <= left || bottom <= top) return false
      }
      return getComputedStyle(element).visibility !== 'collapse'
    }
    if (/just a moment|attention required|checking your browser/.test(title)) challengeSignals.push('challenge-title')
    const walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT)
    const challengeText: string[] = []
    let length = 0, visited = 0
    for (let text = walker.nextNode(); text && length < 100000 && visited++ < 10000; text = walker.nextNode()) {
      const element = text.parentElement
      if (!element || !text.textContent!.trim() || !challengeVisible(element)) continue
      const range = document.createRange()
      range.selectNodeContents(text)
      if (![...range.getClientRects()].some(rect => rect.width > 0 && rect.height > 0 && challengeVisible(element, rect))) continue
      const value = text.textContent!.slice(0, 100000 - length)
      challengeText.push(value); length += value.length
    }
    if (/verify (?:that )?you are human|complete (?:the )?captcha|checking your browser|enable javascript and cookies to continue/.test(compact(challengeText.join(' ')).toLocaleLowerCase('en-US'))) challengeSignals.push('human-verification')
    if ([...document.querySelectorAll('.cf-turnstile,[id*="captcha" i],[class*="captcha" i],iframe[src*="captcha" i],iframe[src*="challenge" i]')].some(element => challengeVisible(element))) challengeSignals.push('challenge-control')
  }
  const loginSignals: string[] = []
  const passwordField = [...document.querySelectorAll('input[type="password"]')].some(visible)
  if (passwordField) loginSignals.push('password-field')
  if (/sign in to continue|login required|log in required|authentication required/.test(title + ' ' + headingText + ' ' + lowerBody.slice(0, 2000))) loginSignals.push('sign-in-copy')
  if (loginSignals.length === 1 && loginSignals[0] === 'password-field' && !/(sign in|log in|login|account)/.test(title + ' ' + headingText)) loginSignals.length = 0
  const soft404Signals: string[] = []
  if (/^(?:404\b|page not found\b|not found\b)|\b404\s*[-|:]/.test(title)) soft404Signals.push('not-found-title')
  if (/^(?:404\b|page not found\b|not found\b)|the requested page does not exist/.test(headingText + ' ' + lowerBody.slice(0, 2000))) soft404Signals.push('not-found-copy')
  const cookieSignals: string[] = []
  if (/we use cookies|accept all cookies|cookie preferences|manage cookies/.test(lowerBody.slice(0, 5000))) cookieSignals.push('cookie-consent')
  let expectedSelectorMatched: boolean | undefined
  if (expectedSelector !== null) {
    try {
      const element = document.querySelector(expectedSelector)
      expectedSelectorMatched = Boolean(element && visible(element))
    } catch { expectedSelectorMatched = false }
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
  }
}
