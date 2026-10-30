// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest'
import { browserReconciliationScript, type BrowserReconciliationCondition } from '../src/shared/browser-reconciliation.js'

afterEach(() => {
  document.body.replaceChildren()
  Reflect.deleteProperty(window, 'injected')
})

const condition = (overrides: Partial<BrowserReconciliationCondition> = {}): BrowserReconciliationCondition => ({
  mode: 'upsert', expectedOrigin: location.origin, accountSelector: '#account', expectedAccount: 'QA team',
  stateSelector: '#state', expectedText: 'Saved', ...overrides
})
const read = (overrides: Partial<BrowserReconciliationCondition> = {}): unknown => window.eval(browserReconciliationScript(condition(overrides)))

describe('the browser reconciliation page read', () => {
  it('compares the one state element with the expected text under the one expected account', () => {
    document.body.innerHTML = '<div id="account">QA <span>team</span></div><div id="state">Saved</div>'
    expect(read()).toBe('matches')
    document.querySelector('#state')!.textContent = 'Draft'
    expect(read()).toBe('differs')
    expect(read({ mode: 'update', expectedCurrentText: 'Draft' })).toBe('differs')
    expect(read({ mode: 'update', expectedCurrentText: 'Published' })).toBe('precondition-changed')
    document.querySelector('#state')!.remove()
    expect(read()).toBe('missing')
    document.body.insertAdjacentHTML('beforeend', '<div id="state">Saved</div><div id="state">Saved</div>')
    expect(read()).toBe('ambiguous')
  })

  it('reports another context for another origin, account, or no single account', () => {
    document.body.innerHTML = '<div id="account">QA team</div><div id="state">Saved</div>'
    expect(read({ expectedOrigin: 'https://example.invalid' })).toBe('context-changed')
    expect(read({ expectedAccount: 'Ops team' })).toBe('context-changed')
    expect(read({ accountSelector: '#nobody' })).toBe('context-changed')
    document.body.insertAdjacentHTML('beforeend', '<div id="account">QA team</div>')
    expect(read()).toBe('context-changed')
    document.querySelectorAll('#account')[1]!.remove()
    document.querySelector('#account')!.textContent = 'x'.repeat(513)
    expect(read({ expectedAccount: 'x'.repeat(512) })).toBe('context-changed')
  })

  it('reads nothing past its bounds and treats selectors as data', () => {
    document.body.innerHTML = '<div id="account">QA team</div><div id="state"></div>'
    const state = document.querySelector('#state')!
    state.textContent = 'é'.repeat(256)
    expect(read({ expectedText: 'é'.repeat(256) })).toBe('matches')
    state.textContent += 'x'
    expect(read()).toBe('unavailable')
    state.replaceChildren(...Array.from({ length: 1025 }, () => document.createTextNode('')))
    expect(read()).toBe('unavailable')
    expect(read({ stateSelector: '[' })).toBe('unavailable')
    expect(read({ accountSelector: '[' })).toBe('unavailable')
    expect(read({ stateSelector: '";window.injected=true;//' })).toBe('unavailable')
    expect((window as unknown as { injected?: boolean }).injected).toBeUndefined()
  })
})
