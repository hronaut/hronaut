import { describe, expect, it } from 'vitest'
import {
  canonicalizeWorkspaceNavigationRule,
  evaluateWorkspaceNavigation,
  normalizeWorkspaceNavigationPolicy
} from '../src/main/browser/workspace-navigation-policy.js'

describe('workspace navigation policies', () => {
  it.each([
    ['https://Example.COM:443/', 'https://example.com'],
    ['*.BÜCHER.example.', '*.xn--bcher-kva.example'],
    ['https://*.Example.com:8443', 'https://*.example.com:8443'],
    ['https://*.Example.com:443', 'https://*.example.com'],
    ['http://localhost:*', 'http://localhost:*'],
    ['http://[::1]:*', 'http://[::1]:*']
  ])('canonicalizes %s without retaining paths or display ambiguity', (input, expected) => {
    expect(canonicalizeWorkspaceNavigationRule(input)).toBe(expected)
  })

  it.each([
    'https://user:secret@example.com',
    'https://example.com/private',
    'https://example.com?token=secret',
    '*.*.example.com',
    'https://example.com:*',
    'http://example.com:*',
    'file:///tmp/private',
    'javascript:alert(1)'
  ])('rejects unsafe or ambiguous rule %s', (rule) => {
    expect(() => canonicalizeWorkspaceNavigationRule(rule)).toThrow()
  })

  it('matches exact origins without leaking URL paths into decisions', () => {
    const policy = normalizeWorkspaceNavigationPolicy({
      mode: 'restricted',
      rules: ['https://shop.example']
    })

    expect(evaluateWorkspaceNavigation(policy, 'https://shop.example/private?token=secret#fragment')).toEqual({
      allowed: true,
      targetOrigin: 'https://shop.example',
      matchedRule: 'https://shop.example',
      reason: 'matched'
    })
    expect(evaluateWorkspaceNavigation(policy, 'https://shop.example.evil.test/private')).toEqual({
      allowed: false,
      targetOrigin: 'https://shop.example.evil.test',
      reason: 'no-match'
    })
  })

  it('matches subdomain rules only at a hostname boundary and not at the apex', () => {
    const policy = normalizeWorkspaceNavigationPolicy({ mode: 'restricted', rules: ['*.example.com'] })

    expect(evaluateWorkspaceNavigation(policy, 'https://api.example.com/v1').allowed).toBe(true)
    expect(evaluateWorkspaceNavigation(policy, 'http://deep.api.example.com:8080/').allowed).toBe(true)
    expect(evaluateWorkspaceNavigation(policy, 'https://example.com/').allowed).toBe(false)
    expect(evaluateWorkspaceNavigation(policy, 'https://api.example.com.evil.test/').allowed).toBe(false)
  })

  it('keeps scheme and port constraints for scoped wildcard rules', () => {
    const policy = normalizeWorkspaceNavigationPolicy({
      mode: 'restricted',
      rules: ['https://*.example.com:8443', 'http://localhost:*']
    })

    expect(evaluateWorkspaceNavigation(policy, 'https://api.example.com:8443/').allowed).toBe(true)
    expect(evaluateWorkspaceNavigation(policy, 'https://api.example.com/').allowed).toBe(false)
    expect(evaluateWorkspaceNavigation(policy, 'http://api.example.com:8443/').allowed).toBe(false)
    expect(evaluateWorkspaceNavigation(policy, 'http://localhost:5173/').allowed).toBe(true)
    expect(evaluateWorkspaceNavigation(policy, 'https://localhost:5173/').allowed).toBe(false)
  })

  it('matches scoped wildcard rules that spell the scheme default port explicitly', () => {
    const policy = normalizeWorkspaceNavigationPolicy({
      mode: 'restricted',
      rules: ['https://*.example.com:443', 'http://*.internal.example:80']
    })

    expect(evaluateWorkspaceNavigation(policy, 'https://api.example.com/').allowed).toBe(true)
    expect(evaluateWorkspaceNavigation(policy, 'http://api.internal.example/').allowed).toBe(true)
  })

  it('evaluates view-source and blob URLs against their embedded HTTP origin', () => {
    const policy = normalizeWorkspaceNavigationPolicy({ mode: 'restricted', rules: ['https://docs.example'] })

    expect(evaluateWorkspaceNavigation(policy, 'view-source:https://docs.example/guide').allowed).toBe(true)
    expect(evaluateWorkspaceNavigation(policy, 'blob:https://docs.example/01912345-6789-7abc-8def-0123456789ab').allowed).toBe(true)
    expect(evaluateWorkspaceNavigation(policy, 'data:text/html,<h1>fixture</h1>')).toEqual({
      allowed: false,
      targetOrigin: 'data:',
      reason: 'unsupported-scheme'
    })
  })

  it('allows the neutral blank page but rejects credentials and malformed targets', () => {
    const policy = normalizeWorkspaceNavigationPolicy({ mode: 'restricted', rules: ['https://example.com'] })

    expect(evaluateWorkspaceNavigation(policy, 'about:blank')).toEqual({
      allowed: true,
      targetOrigin: 'about:blank',
      reason: 'neutral'
    })
    expect(evaluateWorkspaceNavigation(policy, 'https://user:secret@example.com/private')).toEqual({
      allowed: false,
      targetOrigin: 'https://example.com',
      reason: 'credentials'
    })
    expect(evaluateWorkspaceNavigation(policy, 'https://[')).toEqual({
      allowed: false,
      targetOrigin: 'invalid URL',
      reason: 'malformed'
    })
  })

  it('deduplicates canonical rules and defaults legacy workspaces to unrestricted', () => {
    expect(normalizeWorkspaceNavigationPolicy(undefined)).toEqual({ mode: 'unrestricted', rules: [] })
    expect(normalizeWorkspaceNavigationPolicy({
      mode: 'restricted',
      rules: ['https://EXAMPLE.com/', 'https://example.com']
    })).toEqual({ mode: 'restricted', rules: ['https://example.com'] })
  })
})
