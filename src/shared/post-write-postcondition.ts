import { pageScript } from './page-script.js'
import { postconditionInPage } from './post-write-postcondition.page.js'
import { continuityMarkerInPage } from './workspace-continuity-marker.page.js'
import { validateContinuityMarkerSelector } from './workspace-continuity-marker.js'

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
  validateContinuityMarkerSelector(input.accountSelector)
  validateContinuityMarkerSelector(input.stateSelector)
  return pageScript(
    postconditionInPage, origin.origin, input.accountSelector, input.expectedAccount, input.stateSelector, input.expectedText,
    continuityMarkerInPage
  )
}
