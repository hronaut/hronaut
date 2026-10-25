import { describe, expect, it } from 'vitest'
import {
  SITE_SEARCH_LIMIT,
  cleanSiteSearchKeyword,
  readSiteSearches,
  siteSearchFromDraft,
  siteSearchProblems,
  siteSearchUrl,
  type SiteSearch
} from '../src/shared/site-search.js'

// Hronaut had no site search: the address bar searched only the built-in engines by their sites. Chrome's Settings >
// Search engine > Site search keeps shortcuts that each search a site through an address with %s for the terms.

const WIKIPEDIA: SiteSearch = { id: 'wiki', name: 'Wikipedia', keyword: 'w', url: 'https://en.wikipedia.org/w/index.php?search=%s' }

describe('site search rules', () => {
  it('cleans a shortcut as Chrome cleans a typed keyword', () => {
    expect(cleanSiteSearchKeyword('  W ')).toBe('w')
    expect(cleanSiteSearchKeyword('https://www.Example.org/')).toBe('example.org')
    expect(cleanSiteSearchKeyword('http://docs')).toBe('docs')
    expect(cleanSiteSearchKeyword('www.')).toBe('')
  })

  it('accepts a named shortcut with a web address that has %s where the terms go', () => {
    expect(siteSearchProblems({ name: ' Wikipedia ', keyword: 'W', url: ' https://en.wikipedia.org/w/index.php?search=%s ' }, [])).toEqual({})
    expect(siteSearchFromDraft('wiki', { name: ' Wikipedia ', keyword: 'W', url: ' https://en.wikipedia.org/w/index.php?search=%s ' }))
      .toEqual(WIKIPEDIA)
    expect(siteSearchProblems({ name: 'Docs', keyword: 'd', url: 'http://localhost:8080/search/%s' }, [WIKIPEDIA])).toEqual({})
  })

  it('names what keeps each field from being saved', () => {
    expect(siteSearchProblems({ name: ' ', keyword: '', url: '' }, [])).toEqual({
      name: 'nameMissing',
      keyword: 'keywordMissing',
      url: 'urlInvalid'
    })
    expect(siteSearchProblems({ name: 'x'.repeat(101), keyword: 'w'.repeat(101), url: `https://example.org/?q=%s${'a'.repeat(2_048)}` }, [])).toEqual({
      name: 'nameTooLong',
      keyword: 'keywordTooLong',
      url: 'urlTooLong'
    })
    expect(siteSearchProblems({ name: 'A', keyword: 'two words', url: 'https://example.org/' }, []))
      .toEqual({ keyword: 'keywordSpaces', url: 'urlNoQuery' })
    for (const url of ['example.org/?q=%s', 'javascript:alert(%s)', 'file:///tmp/%s', 'https:///%s', 'https://%s.example.org/']) {
      expect(siteSearchProblems({ name: 'A', keyword: 'a', url }, []).url, url).toBe('urlInvalid')
    }
  })

  it('keeps each shortcut to one site search, and away from the engines\' sites and @bookmarks, @history and @tabs', () => {
    for (const keyword of ['W', 'www.w', 'bing.com', 'https://www.google.com/', '@tabs', '@History', '@bookmarks']) {
      expect(siteSearchProblems({ name: 'A', keyword, url: 'https://example.org/?q=%s' }, [WIKIPEDIA]).keyword, keyword).toBe('keywordTaken')
    }
    // Editing a site search keeps its own shortcut free for it.
    expect(siteSearchProblems({ name: 'Wiki', keyword: 'w', url: WIKIPEDIA.url }, [])).toEqual({})
  })

  it('reads back only well-formed site searches with their own ids and shortcuts, up to the limit', () => {
    expect(readSiteSearches(undefined)).toEqual([])
    expect(readSiteSearches({ 0: WIKIPEDIA })).toEqual([])
    expect(readSiteSearches([
      WIKIPEDIA,
      { ...WIKIPEDIA, id: 'again' },
      { ...WIKIPEDIA, keyword: 'other' },
      { id: 'bad id', name: 'A', keyword: 'a', url: 'https://a.example/?q=%s' },
      { id: 'no-url', name: 'B', keyword: 'b' },
      { id: 'no-query', name: 'C', keyword: 'c', url: 'https://c.example/' },
      null,
      'w',
      { id: 'docs', name: ' Docs ', keyword: 'D', url: 'https://docs.example/?q=%s', extra: true }
    ])).toEqual([WIKIPEDIA, { id: 'docs', name: 'Docs', keyword: 'd', url: 'https://docs.example/?q=%s' }])
    const many = Array.from({ length: SITE_SEARCH_LIMIT + 5 }, (_, index) => ({
      id: `site-${index}`,
      name: `Site ${index}`,
      keyword: `s${index}`,
      url: `https://s${index}.example/?q=%s`
    }))
    expect(readSiteSearches(many)).toHaveLength(SITE_SEARCH_LIMIT)
  })

  it('puts the terms in place of each %s, and goes to the site\'s home page for none', () => {
    expect(siteSearchUrl(WIKIPEDIA.url, ' a&b c ')).toBe('https://en.wikipedia.org/w/index.php?search=a%26b%20c')
    expect(siteSearchUrl('https://example.org/%s/?q=%s', 'x/y')).toBe('https://example.org/x%2Fy/?q=x%2Fy')
    expect(siteSearchUrl(WIKIPEDIA.url, '   ')).toBe('https://en.wikipedia.org/')
    expect(siteSearchUrl('http://localhost:8080/search/%s', '')).toBe('http://localhost:8080/')
  })
})
