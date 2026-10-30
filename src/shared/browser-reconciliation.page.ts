import type { BrowserReconciliationEvidence } from './browser-reconciliation.js'

/**
 * Runs in the reconciliation's isolated world and only reads: how the one element the state selector matches compares
 * with the expected text, as a fixed evidence answer, under the one expected account. Texts with more than 1024 nodes
 * or 512 characters or bytes are not read.
 */
export function reconciliationEvidenceInPage(
  origin: string,
  accountSelector: string,
  expectedAccount: string,
  stateSelector: string,
  expectedText: string,
  expectedCurrentText: string | undefined
): BrowserReconciliationEvidence {
  try {
    if (location.origin !== origin) return 'context-changed'
    const read = (element: Element): string | null => {
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
      let value = '', nodes = 0, node: Text | null
      while ((node = walker.nextNode() as Text | null)) {
        if (++nodes > 1024 || value.length + node.data.length > 512) return null
        value += node.data
      }
      return new TextEncoder().encode(value).length <= 512 ? value : null
    }
    const accounts = document.querySelectorAll(accountSelector)
    if (accounts.length !== 1) return 'context-changed'
    const account = read(accounts[0]!)
    if (account === null || account !== expectedAccount) return 'context-changed'
    const targets = document.querySelectorAll(stateSelector)
    if (targets.length === 0) return 'missing'
    if (targets.length !== 1) return 'ambiguous'
    const value = read(targets[0]!)
    if (value === null) return 'unavailable'
    if (value === expectedText) return 'matches'
    if (expectedCurrentText === undefined) return 'differs'
    return value === expectedCurrentText ? 'differs' : 'precondition-changed'
  } catch { return 'unavailable' }
}
