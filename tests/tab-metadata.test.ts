import { describe, expect, it } from 'vitest'
import { MAX_TAB_TITLE_CHARS, normalizeTabTitle } from '../src/main/browser/tab-metadata.js'

describe('tab metadata', () => {
  it('bounds titles without retaining half of a Unicode surrogate pair', () => {
    const title = `${'T'.repeat(MAX_TAB_TITLE_CHARS - 1)}🧪`

    const normalized = normalizeTabTitle(title)

    expect(normalized).toBe('T'.repeat(MAX_TAB_TITLE_CHARS - 1))
    expect(normalized.length).toBeLessThanOrEqual(MAX_TAB_TITLE_CHARS)
  })
})
