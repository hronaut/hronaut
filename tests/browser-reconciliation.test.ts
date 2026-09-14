import { describe, expect, it } from 'vitest'
import {
  browserReconciliationScript,
  classifyBrowserReconciliation,
  type BrowserReconciliationEvidence
} from '../src/shared/browser-reconciliation.js'

describe('browser reconciliation', () => {
  it.each([
    ['create', 'missing', 'new', true],
    ['update', 'missing', 'not_found', false],
    ['upsert', 'missing', 'new', true],
    ['create', 'matches', 'already_present', false],
    ['update', 'differs', 'changed', true],
    ['upsert', 'differs', 'changed', true],
    ['create', 'differs', 'changed', false],
    ['update', 'precondition-changed', 'blocked', false],
    ['update', 'context-changed', 'blocked', false],
    ['update', 'ambiguous', 'unknown', false],
    ['update', 'unavailable', 'unknown', false]
  ] as const)('classifies %s %s as %s', (mode, evidence, status, actionable) => {
    expect(classifyBrowserReconciliation(mode, evidence as BrowserReconciliationEvidence)).toMatchObject({ status, actionable })
  })

  it('generates a bounded fixed-enum comparison without embedding executable page hooks', () => {
    const script = browserReconciliationScript({
      mode: 'update', expectedOrigin: 'https://example.com', accountSelector: '#account',
      expectedAccount: 'QA', stateSelector: '#state', expectedCurrentText: 'old', expectedText: 'new'
    })
    expect(script).toContain("'precondition-changed'")
    expect(script).toContain('document.querySelectorAll')
    expect(script).not.toContain('innerText')
    expect(() => browserReconciliationScript({
      mode: 'update', expectedOrigin: 'https://example.com', accountSelector: '#account',
      expectedAccount: 'QA', stateSelector: '#state', expectedText: 'new'
    })).toThrow(/expectedCurrentText/)
    expect(() => browserReconciliationScript({
      mode: 'create', expectedOrigin: 'https://example.com', accountSelector: '😀'.repeat(65),
      expectedAccount: 'QA', stateSelector: '#state', expectedText: 'new'
    })).toThrow(/256 UTF-8 bytes/)
  })
})
