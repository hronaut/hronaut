import { describe, expect, it } from 'vitest'
import { networkRoutePatternMatches, validateNetworkRoutePattern } from '../src/shared/network-routes.js'

describe('network route URL patterns', () => {
  it('matches the same wildcard syntax used by CDP Fetch patterns', () => {
    expect(networkRoutePatternMatches('https://api.example.com/v1/*', 'https://api.example.com/v1/users?id=7')).toBe(true)
    expect(networkRoutePatternMatches('*://*.example.com/data/?', 'https://api.example.com/data/7')).toBe(true)
    expect(networkRoutePatternMatches('https://example.com/literal\\?value=*', 'https://example.com/literal?value=yes')).toBe(true)
    expect(networkRoutePatternMatches('https://api.example.com/v1/*', 'https://api.example.com/v2/users')).toBe(false)
    expect(networkRoutePatternMatches(`${'*'.repeat(2_000)}z`, 'a'.repeat(20_000))).toBe(false)
  })

  it('requires an explicit, bounded web-style pattern', () => {
    expect(validateNetworkRoutePattern('https://example.com/api/*')).toBe('https://example.com/api/*')
    expect(validateNetworkRoutePattern('*://example.com/*')).toBe('*://example.com/*')
    expect(() => validateNetworkRoutePattern('/api/*')).toThrow('include a scheme')
    expect(() => validateNetworkRoutePattern(`https://example.com/${'x'.repeat(2_100)}`)).toThrow('2,048')
    expect(() => validateNetworkRoutePattern('https://example.com/\n')).toThrow('control characters')
  })
})
