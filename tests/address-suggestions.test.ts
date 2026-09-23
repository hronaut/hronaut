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

  it('keeps a visited hostname ahead of bookmarks that only mention the query', () => {
    const mentioningBookmarks = Array.from({ length: 10 }, (_, index) => ({
      id: `guide-${index}`,
      title: `Google integration guide ${index}`,
      url: `https://guides.example/${index}`
    }))
    const suggestions = buildLocalAddressSuggestions({
      query: 'google',
      bookmarks: mentioningBookmarks,
      history: [{ id: 'google', title: 'Search engine', url: 'https://www.google.com/', visitCount: 3 }]
    })

    expect(suggestions).toHaveLength(8)
    expect(suggestions[0]).toMatchObject({ kind: 'history', url: 'https://www.google.com/' })
    expect(suggestions[1]).toMatchObject({ id: 'bookmark:guide-0' })
  })

  it('ranks hostname prefixes ahead of incidental matches in history titles and query strings', () => {
    const suggestions = buildLocalAddressSuggestions({
      query: 'GOOGLE',
      bookmarks: [],
      history: [
        { id: 'search', title: 'Results', url: 'https://other.example/search?q=google', visitCount: 4 },
        { id: 'guide', title: 'Google guide', url: 'https://guides.example/', visitCount: 2 },
        { id: 'google', title: 'Search engine', url: 'https://www.google.com/', visitCount: 1 }
      ],
      limit: 1
    })

    expect(suggestions).toEqual([expect.objectContaining({ id: 'history:google' })])
  })

  it('prefers a visited address over its bookmark and preserves explicit scopes', () => {
    const google = { id: 'google', title: 'Saved search engine', url: 'https://www.google.com/' }
    const visits = [{ id: 'google-visit', title: 'Search engine', url: google.url, visitCount: 1 }]

    expect(buildLocalAddressSuggestions({ query: 'google', bookmarks: [google], history: visits }))
      .toEqual([expect.objectContaining({ id: 'history:google-visit' })])
    expect(buildLocalAddressSuggestions({ query: '@history google', bookmarks: [google], history: visits }))
      .toEqual([expect.objectContaining({ id: 'history:google-visit' })])
    expect(buildLocalAddressSuggestions({ query: '@bookmarks google', bookmarks: [google], history: visits }))
      .toEqual([expect.objectContaining({ id: 'bookmark:google' })])
  })

  it('keeps bookmarked page sections as distinct destinations beside page history', () => {
    const sections = [
      { id: 'intro', title: 'Guide introduction', url: 'https://docs.example/guide#intro' },
      { id: 'api', title: 'Guide API', url: 'https://docs.example/guide#api' }
    ]
    const visits = [{
      id: 'guide', title: 'Guide', url: 'https://docs.example/guide', visitCount: 3
    }]

    expect(buildLocalAddressSuggestions({ query: 'guide', bookmarks: sections, history: visits })
      .map((suggestion) => suggestion.id))
      .toEqual(['history:guide', 'bookmark:intro', 'bookmark:api'])
    expect(buildLocalAddressSuggestions({ query: '@bookmarks guide', bookmarks: sections, history: visits })
      .map((suggestion) => suggestion.url))
      .toEqual(['https://docs.example/guide#intro', 'https://docs.example/guide#api'])
  })

  it('puts a matching visited page before a matching bookmark while typing', () => {
    expect(buildLocalAddressSuggestions({
      query: 'docs',
      bookmarks: [{ id: 'saved', title: 'Docs bookmark', url: 'https://saved.example/' }],
      history: [{ id: 'visited', title: 'Docs visited', url: 'https://visited.example/', visitCount: 1 }]
    }).map((suggestion) => suggestion.id)).toEqual(['history:visited', 'bookmark:saved'])
  })

  it('keeps visited pages ahead of bookmark hostname matches', () => {
    const input = {
      query: 'google',
      bookmarks: [{ id: 'saved', title: 'Saved page', url: 'https://google.example/' }],
      history: [{ id: 'visited', title: 'Google account', url: 'https://account.example/', visitCount: 2 }]
    }
    expect(buildLocalAddressSuggestions(input).map((suggestion) => suggestion.id))
      .toEqual(['history:visited', 'bookmark:saved'])
    expect(buildLocalAddressSuggestions({ ...input, limit: 1 }).map((suggestion) => suggestion.id))
      .toEqual(['history:visited'])
  })
})
