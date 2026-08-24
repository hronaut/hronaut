import { describe, expect, it } from 'vitest'
import { searchSnapshot } from '../src/shared/snapshot-search.js'

describe('snapshot search', () => {
  it('returns compact case-insensitive snippets with source offsets', () => {
    const result = searchSnapshot(
      'URL: https://example.test/\nTITLE: Orders\n[e1] button "Retry order"\nTEXT: First order failed. Retry the order after reviewing it.',
      { query: 'retry', contextChars: 24 }
    )

    expect(result).toMatchObject({ query: 'retry', caseSensitive: false, truncated: false })
    expect(result.matches).toHaveLength(2)
    expect(result.matches[0]).toMatchObject({ index: expect.any(Number), snippet: expect.stringContaining('Retry order') })
    expect(result.matches[1]?.snippet).toContain('Retry the order')
    expect(result.matches.every((match) => !match.snippet.includes('\n'))).toBe(true)
  })

  it('bounds output and reports additional matches without scanning unbounded content', () => {
    const result = searchSnapshot('match '.repeat(100), { query: 'match', maxMatches: 3 })

    expect(result.matches).toHaveLength(3)
    expect(result.truncated).toBe(true)
    expect(result.caveats).toHaveLength(2)
  })

  it('supports exact case and rejects invalid queries', () => {
    expect(searchSnapshot('Alpha alpha', { query: 'Alpha', caseSensitive: true }).matches).toHaveLength(1)
    expect(() => searchSnapshot('content', { query: '   ' })).toThrow('cannot be empty')
    expect(() => searchSnapshot('content', { query: 'x'.repeat(201) })).toThrow('cannot exceed 200')
  })

  it('treats regular-expression characters literally and preserves Unicode source offsets', () => {
    expect(searchSnapshot('Price is $5.00, not $50.00', { query: '$5.00' }).matches).toHaveLength(1)
    expect(searchSnapshot('İx target', { query: 'x' }).matches[0]).toMatchObject({ index: 1 })
  })
})
