import { describe, expect, it } from 'vitest'
import { buildLocalAddressSuggestions } from '../src/shared/address-suggestions.js'

describe('buildLocalAddressSuggestions', () => {
  const bookmarks = [
    { id: 'duplicate', title: 'Saved documentation', url: 'https://docs.example/guide' },
    { id: 'design', title: 'Design reference', url: 'https://design.example/' }
  ]
  const history = [
    { id: 'docs-history', title: 'Old docs visit', url: 'https://docs.example/guide#old', visitCount: 4 },
    { id: 'release', title: 'Project release notes', url: 'https://release.example/', visitCount: 2 }
  ]

  it('keeps open tabs out of address suggestions and deduplicates saved URLs across sources', () => {
    expect(buildLocalAddressSuggestions({
      query: 'project',
      bookmarks,
      history
    })).toEqual([
      expect.objectContaining({ kind: 'history', title: 'Project release notes', visitCount: 2 })
    ])
  })

  it('supports explicit local scopes, multi-term matching, and bounded output', () => {
    expect(buildLocalAddressSuggestions({
      query: '@bookmarks design reference',
      bookmarks,
      history
    })).toEqual([
      expect.objectContaining({ kind: 'bookmark', title: 'Design reference' })
    ])
    expect(buildLocalAddressSuggestions({
      query: '@history',
      bookmarks,
      history,
      limit: 1
    })).toEqual([
      expect.objectContaining({ kind: 'history', title: 'Old docs visit' })
    ])
  })

  it('shows recent history on an empty query and nothing for an unknown address', () => {
    expect(buildLocalAddressSuggestions({ query: '', bookmarks, history })).toEqual([
      expect.objectContaining({ kind: 'history', title: 'Old docs visit', visitCount: 4 }),
      expect.objectContaining({ kind: 'history', title: 'Project release notes', visitCount: 2 }),
      expect.objectContaining({ kind: 'bookmark', title: 'Design reference' })
    ])
    expect(buildLocalAddressSuggestions({ query: 'current', bookmarks, history })).toEqual([])
  })
})
