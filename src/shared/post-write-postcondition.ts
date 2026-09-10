import { continuityMarkerScript } from './workspace-continuity-marker.js'

export interface BrowserPostcondition {
  expectedOrigin: string
  accountSelector: string
  expectedAccount: string
  stateSelector: string
  expectedText: string
}

/** Generate a main-owned isolated-world comparison. Expected values remain
 * private; only bounded comparison enums cross back from the page. An account
 * marker match is declared UI evidence, not proof of provider authentication.
 */
export function browserPostconditionScript(input: BrowserPostcondition): string {
  const origin = new URL(input.expectedOrigin)
  if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password || input.expectedOrigin !== origin.origin) throw new TypeError('Expected origin must be an HTTP(S) origin')
  for (const value of [input.expectedAccount, input.expectedText]) {
    if (typeof value !== 'string' || new TextEncoder().encode(value).length > 512) throw new TypeError('Expected marker text exceeds its bound')
  }
  if (!input.expectedAccount.trim()) throw new TypeError('Expected account marker is required')
  const account = continuityMarkerScript(input.accountSelector)
  const state = continuityMarkerScript(input.stateSelector)
  return `(() => {
    try {
      if (location.origin !== ${JSON.stringify(origin.origin)}) return 'context-changed';
      const account = ${account};
      if (account === null) return 'unavailable';
      if (account !== ${JSON.stringify(input.expectedAccount)}) return 'context-changed';
      if (document.querySelectorAll(${JSON.stringify(input.stateSelector)}).length === 0) return 'not-yet-visible';
      const state = ${state};
      if (state === null) return 'unavailable';
      return state === ${JSON.stringify(input.expectedText)} ? 'matches' : 'not-yet-visible';
    } catch { return 'unavailable'; }
  })()`
}
