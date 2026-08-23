import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SEARCH_ENGINE,
  isSearchEngineName,
  SEARCH_ENGINE_OPTIONS,
  searchUrl
} from '../src/shared/search-engine.js'

describe('search engines', () => {
  it('keeps every supported engine unique and HTTPS', () => {
    expect(new Set(SEARCH_ENGINE_OPTIONS.map((engine) => engine.id)).size).toBe(SEARCH_ENGINE_OPTIONS.length)
    expect(new Set(SEARCH_ENGINE_OPTIONS.map((engine) => engine.hostname)).size).toBe(SEARCH_ENGINE_OPTIONS.length)
    for (const engine of SEARCH_ENGINE_OPTIONS) {
      expect(engine.template).toContain('%s')
      expect(new URL(engine.template.replace('%s', 'query')).protocol).toBe('https:')
      expect(isSearchEngineName(engine.id)).toBe(true)
    }
  })

  it('uses Google as the backwards-compatible default', () => {
    expect(DEFAULT_SEARCH_ENGINE).toBe('google')
    expect(searchUrl('two words')).toBe('https://www.google.com/search?q=two%20words')
  })

  it('rejects unsupported and malformed names', () => {
    expect(isSearchEngineName('yahoo')).toBe(false)
    expect(isSearchEngineName(null)).toBe(false)
  })
})
