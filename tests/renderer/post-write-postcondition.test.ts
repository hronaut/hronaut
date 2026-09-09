import { afterEach, expect, it } from 'vitest'
import { browserPostconditionScript, type BrowserPostcondition } from '../../src/shared/post-write-postcondition.js'

afterEach(() => document.body.replaceChildren())
const contract = (): BrowserPostcondition => ({ expectedOrigin: location.origin, accountSelector: '#account', expectedAccount: 'Account fixture', stateSelector: '#state', expectedText: 'Saved fixture' })
const read = (overrides: Partial<BrowserPostcondition> = {}): unknown => window.eval(browserPostconditionScript({ ...contract(), ...overrides }))

it('matches only the declared account and exact state without exposing either value', () => {
  document.body.innerHTML = '<div id="account">Account <span>fixture</span></div><div id="state">Saved fixture</div><input value="private draft">'
  expect(read()).toBe('matches')
  expect(read({ expectedAccount: 'Another account' })).toBe('context-changed')
  expect(read({ expectedOrigin: 'https://example.invalid' })).toBe('context-changed')
  expect(document.querySelector('input')!.value).toBe('private draft')
})

it('keeps missing or stale postconditions distinct from unverifiable account context', () => {
  document.body.innerHTML = '<div id="account">Account fixture</div>'
  expect(read()).toBe('not-yet-visible')
  document.body.innerHTML += '<div id="state">Saving</div>'
  expect(read()).toBe('not-yet-visible')
  document.querySelector('#account')!.remove()
  expect(read()).toBe('unavailable')
})

it('rejects ambiguous and oversized evidence instead of matching a prefix', () => {
  document.body.innerHTML = '<div id="account">Account fixture</div><div id="state">Saved fixture</div><div id="state">Saved fixture</div>'
  expect(read()).toBe('unavailable')
  document.querySelector('#state')!.remove()
  document.querySelector('#state')!.textContent = 'Saved fixture' + 'x'.repeat(512)
  expect(read()).toBe('unavailable')
  expect(read({ stateSelector: '[' })).toBe('unavailable')
})

it('bounds private inputs and treats selector payloads as data', () => {
  document.body.innerHTML = '<div id="account">Account fixture</div>'
  expect(() => read({ expectedAccount: '' })).toThrow(/account/)
  expect(() => read({ expectedText: 'é'.repeat(257) })).toThrow(/bound/)
  expect(() => read({ expectedOrigin: 'https://user:secret@example.invalid' })).toThrow(/origin/)
  expect(read({ stateSelector: '";window.injected=true;//' })).toBe('unavailable')
  expect((window as unknown as { injected?: boolean }).injected).toBeUndefined()
})
