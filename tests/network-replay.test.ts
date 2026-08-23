import { describe, expect, it } from 'vitest'
import { networkReplayRequiresConfirmation, networkReplayUrlPattern } from '../src/shared/network-replay.js'
import { networkRoutePatternMatches } from '../src/shared/network-routes.js'

describe('network request replay safety', () => {
  it('allows only read-only GET and HEAD requests without confirmation', () => {
    expect(networkReplayRequiresConfirmation('GET')).toBe(false)
    expect(networkReplayRequiresConfirmation(' head ')).toBe(false)
    expect(networkReplayRequiresConfirmation('POST')).toBe(true)
    expect(networkReplayRequiresConfirmation('PATCH')).toBe(true)
    expect(networkReplayRequiresConfirmation('DELETE')).toBe(true)
  })

  it('escapes wildcard characters when waiting for the exact replayed URL', () => {
    const url = 'https://example.test/items?query=a*b\\c'
    const pattern = networkReplayUrlPattern(url)
    expect(networkRoutePatternMatches(pattern, url)).toBe(true)
    expect(networkRoutePatternMatches(pattern, 'https://example.test/itemsXquery=axb\\c')).toBe(false)
  })
})
