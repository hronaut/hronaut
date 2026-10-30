import { pageScript } from './page-script.js'
import { reconciliationEvidenceInPage } from './browser-reconciliation.page.js'

export type BrowserReconciliationMode = 'create' | 'update' | 'upsert'
export type BrowserReconciliationEvidence =
  | 'matches'
  | 'missing'
  | 'differs'
  | 'precondition-changed'
  | 'context-changed'
  | 'ambiguous'
  | 'unavailable'
export type BrowserReconciliationStatus = 'new' | 'already_present' | 'changed' | 'not_found' | 'blocked' | 'unknown'

export interface BrowserReconciliationCondition {
  mode: BrowserReconciliationMode
  expectedOrigin: string
  accountSelector: string
  expectedAccount: string
  stateSelector: string
  expectedText: string
  expectedCurrentText?: string
}

export interface BrowserReconciliationResult {
  status: BrowserReconciliationStatus
  reason:
    | 'TARGET_MISSING'
    | 'TARGET_ALREADY_MATCHES'
    | 'TARGET_DIFFERS'
    | 'TARGET_NOT_FOUND'
    | 'PRECONDITION_CHANGED'
    | 'CONTEXT_CHANGED'
    | 'TARGET_AMBIGUOUS'
    | 'READ_UNAVAILABLE'
  actionable: boolean
  authoritativeRepresentation: 'visible-page-text'
  retrySafe: boolean
}

function validateCondition(input: BrowserReconciliationCondition): URL {
  if (!['create', 'update', 'upsert'].includes(input.mode)) throw new TypeError('Unsupported reconciliation mode')
  const origin = new URL(input.expectedOrigin)
  if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password
    || input.expectedOrigin !== origin.origin) throw new TypeError('Expected origin must be an HTTP(S) origin')
  for (const value of [input.expectedAccount, input.expectedText, input.expectedCurrentText]) {
    if (value !== undefined && new TextEncoder().encode(value).length > 512) {
      throw new TypeError('Reconciliation marker text exceeds its bound')
    }
  }
  if (!input.expectedAccount.trim()) throw new TypeError('Expected account marker is required')
  for (const selector of [input.accountSelector, input.stateSelector]) {
    const size = new TextEncoder().encode(selector).length
    if (!selector.trim() || size > 256) throw new TypeError('Reconciliation selector must contain 1 to 256 UTF-8 bytes')
  }
  if (input.mode === 'update' && input.expectedCurrentText === undefined) {
    throw new TypeError('Update reconciliation requires expectedCurrentText')
  }
  return origin
}

/** Generate an isolated-world, read-only comparison. Page text and selectors
 * remain transient; the page returns only a fixed evidence enum.
 */
export function browserReconciliationScript(input: BrowserReconciliationCondition): string {
  const origin = validateCondition(input)
  return pageScript(
    reconciliationEvidenceInPage, origin.origin, input.accountSelector, input.expectedAccount, input.stateSelector, input.expectedText,
    input.expectedCurrentText
  )
}

export function classifyBrowserReconciliation(
  mode: BrowserReconciliationMode,
  evidence: BrowserReconciliationEvidence
): BrowserReconciliationResult {
  if (evidence === 'matches') return {
    status: 'already_present', reason: 'TARGET_ALREADY_MATCHES', actionable: false,
    authoritativeRepresentation: 'visible-page-text', retrySafe: false
  }
  if (evidence === 'missing') return mode === 'update' ? {
    status: 'not_found', reason: 'TARGET_NOT_FOUND', actionable: false,
    authoritativeRepresentation: 'visible-page-text', retrySafe: false
  } : {
    status: 'new', reason: 'TARGET_MISSING', actionable: true,
    authoritativeRepresentation: 'visible-page-text', retrySafe: true
  }
  if (evidence === 'differs') return mode === 'create' ? {
    status: 'changed', reason: 'PRECONDITION_CHANGED', actionable: false,
    authoritativeRepresentation: 'visible-page-text', retrySafe: false
  } : {
    status: 'changed', reason: 'TARGET_DIFFERS', actionable: true,
    authoritativeRepresentation: 'visible-page-text', retrySafe: true
  }
  if (evidence === 'precondition-changed') return {
    status: 'blocked', reason: 'PRECONDITION_CHANGED', actionable: false,
    authoritativeRepresentation: 'visible-page-text', retrySafe: false
  }
  if (evidence === 'context-changed') return {
    status: 'blocked', reason: 'CONTEXT_CHANGED', actionable: false,
    authoritativeRepresentation: 'visible-page-text', retrySafe: false
  }
  if (evidence === 'ambiguous') return {
    status: 'unknown', reason: 'TARGET_AMBIGUOUS', actionable: false,
    authoritativeRepresentation: 'visible-page-text', retrySafe: false
  }
  return {
    status: 'unknown', reason: 'READ_UNAVAILABLE', actionable: false,
    authoritativeRepresentation: 'visible-page-text', retrySafe: false
  }
}
