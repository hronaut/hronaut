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
  const boundedText = `(element) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let value = '', nodes = 0, node;
    while ((node = walker.nextNode())) {
      if (++nodes > 1024 || value.length + node.data.length > 512) return null;
      value += node.data;
    }
    return new TextEncoder().encode(value).length <= 512 ? value : null;
  }`
  return `(() => {
    try {
      if (location.origin !== ${JSON.stringify(origin.origin)}) return 'context-changed';
      const read = ${boundedText};
      const accounts = document.querySelectorAll(${JSON.stringify(input.accountSelector)});
      if (accounts.length !== 1) return 'context-changed';
      const account = read(accounts[0]);
      if (account === null || account !== ${JSON.stringify(input.expectedAccount)}) return 'context-changed';
      const targets = document.querySelectorAll(${JSON.stringify(input.stateSelector)});
      if (targets.length === 0) return 'missing';
      if (targets.length !== 1) return 'ambiguous';
      const value = read(targets[0]);
      if (value === null) return 'unavailable';
      if (value === ${JSON.stringify(input.expectedText)}) return 'matches';
      ${input.expectedCurrentText === undefined
        ? "return 'differs';"
        : `return value === ${JSON.stringify(input.expectedCurrentText)} ? 'differs' : 'precondition-changed';`}
    } catch { return 'unavailable'; }
  })()`
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
