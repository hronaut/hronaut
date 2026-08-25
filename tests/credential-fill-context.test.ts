import { describe, expect, it } from 'vitest'
import {
  credentialFillContext,
  isCurrentCredentialFillContext
} from '../src/main/browser/credential-fill-context.js'

describe('credential fill context', () => {
  it('accepts only the exact document generation captured for the fill', () => {
    const selected = credentialFillContext('https://example.test/login', 7, 3)

    expect(selected).toEqual({
      origin: 'https://example.test',
      url: 'https://example.test/login',
      navigationGeneration: 7,
      tabSelectionGeneration: 3
    })
    expect(isCurrentCredentialFillContext(selected, selected)).toBe(true)
    expect(isCurrentCredentialFillContext(
      selected,
      credentialFillContext('https://example.test/account/password', 8, 3)
    )).toBe(false)
  })

  it('rejects a same-URL reload and cross-origin navigation', () => {
    const selected = credentialFillContext('https://example.test/login', 12, 4)

    expect(isCurrentCredentialFillContext(
      selected,
      credentialFillContext('https://example.test/login', 13, 4)
    )).toBe(false)
    expect(isCurrentCredentialFillContext(
      selected,
      credentialFillContext('https://other.test/login', 12, 4)
    )).toBe(false)
  })

  it('rejects a fill after the user changes tabs, even if they return to the original tab', () => {
    const selected = credentialFillContext('https://example.test/login', 5, 9)

    expect(isCurrentCredentialFillContext(
      selected,
      credentialFillContext('https://example.test/login', 5, 11)
    )).toBe(false)
  })

  it('rejects non-web URLs', () => {
    expect(credentialFillContext('about:blank', 0, 0)).toBeNull()
    expect(credentialFillContext('file:///tmp/login.html', 0, 0)).toBeNull()
    expect(credentialFillContext('not a URL', 0, 0)).toBeNull()
  })
})
