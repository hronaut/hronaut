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

  it('deduplicates saved URLs across sources', () => {
    expect(buildLocalAddressSuggestions({
      query: 'project',
      bookmarks,
      history
    })).toEqual([
      expect.objectContaining({ kind: 'history', title: 'Project release notes', visitCount: 2 })
    ])
  })

  // Open tabs were kept out of the address bar: a page open in another tab could only be opened again. Chrome offers
  // Switch to this tab on such a row, and lists the open tabs with @tabs.
  it('marks a bookmark or visit open in another tab, by the address each is matched with', () => {
    const tabs = [
      { id: 'tab-docs', title: 'Docs', url: 'https://docs.example/guide#section' },
      { id: 'tab-design', title: 'Design', url: 'https://design.example/' },
      { id: 'tab-design-2', title: 'Design again', url: 'https://design.example/' }
    ]
    expect(buildLocalAddressSuggestions({ query: '', bookmarks, history, tabs })).toEqual([
      // A visit is a page, whatever section the tab shows.
      expect.objectContaining({ id: 'history:docs-history', openTabId: 'tab-docs' }),
      expect.not.objectContaining({ openTabId: expect.anything() }),
      // The first tab that shows it.
      expect.objectContaining({ id: 'bookmark:design', openTabId: 'tab-design' })
    ])
    // A bookmark is its own address, section and all.
    expect(buildLocalAddressSuggestions({ query: '@bookmarks guide', bookmarks, history, tabs }))
      .toEqual([{ id: 'bookmark:duplicate', kind: 'bookmark', title: 'Saved documentation', url: 'https://docs.example/guide' }])
    expect(buildLocalAddressSuggestions({ query: '@bookmarks guide', bookmarks, history, tabs: [{ id: 'exact', title: 'Guide', url: 'https://docs.example/guide' }] }))
      .toEqual([expect.objectContaining({ id: 'bookmark:duplicate', openTabId: 'exact' })])
  })

  it('lists the open tabs with @tabs, each its own row in the tab strip\'s order, and switching is the row\'s action', () => {
    const tabs = [
      { id: 'one', title: 'Client dashboard', url: 'https://app.example/dashboard' },
      { id: 'two', title: 'Client dashboard', url: 'https://app.example/dashboard' },
      { id: 'three', title: 'Search', url: 'https://www.search.example/?q=client' },
      { id: 'four', title: 'Docs', url: 'https://docs.example/' }
    ]
    expect(buildLocalAddressSuggestions({ query: '@TABS client', bookmarks, history, tabs })).toEqual([
      { id: 'tab:one', kind: 'tab', title: 'Client dashboard', url: 'https://app.example/dashboard', openTabId: 'one' },
      { id: 'tab:two', kind: 'tab', title: 'Client dashboard', url: 'https://app.example/dashboard', openTabId: 'two' },
      { id: 'tab:three', kind: 'tab', title: 'Search', url: 'https://www.search.example/?q=client', openTabId: 'three' }
    ])
    // A site's tabs come first for a site's name, as visits do.
    expect(buildLocalAddressSuggestions({ query: '@tabs app', bookmarks, history, tabs: [{ id: 'notes', title: 'Notes on the app', url: 'https://notes.example/' }, ...tabs] })
      .map(suggestion => suggestion.id)).toEqual(['tab:one', 'tab:two', 'tab:notes'])
    expect(buildLocalAddressSuggestions({ query: '@tabs', bookmarks, history, tabs, limit: 2 }).map(suggestion => suggestion.id)).toEqual(['tab:one', 'tab:two'])
    // Without @tabs, tabs are not rows of their own; with no other tab, @tabs finds nothing.
    expect(buildLocalAddressSuggestions({ query: 'dashboard', bookmarks, history, tabs })).toEqual([])
    expect(buildLocalAddressSuggestions({ query: '@tabs', bookmarks, history })).toEqual([])
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
