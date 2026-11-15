import { SEARCH_ENGINE_OPTIONS } from './search-engine.js'

/**
 * A site search, as in Chrome's Settings > Search engine > Site search: its shortcut typed in the address bar, then Tab
 * or a space, searches the site through its address, with the search terms in place of %s. Main checks every one it
 * saves with these rules, and the Settings form and the address field read them the same way.
 */
export interface SiteSearch {
  id: string
  /** What the Settings list and the address field's chip show, such as Wikipedia. */
  name: string
  /** What is typed in the address field to search the site, such as w, in the clean form the field matches. */
  keyword: string
  /** The search address, with %s where the search terms go. */
  url: string
}

/** A site search as the Settings form has it, before it is checked and saved. */
export interface SiteSearchDraft {
  name: string
  keyword: string
  url: string
}

export const SITE_SEARCH_LIMIT = 100
export const SITE_SEARCH_NAME_MAX_LENGTH = 100
export const SITE_SEARCH_KEYWORD_MAX_LENGTH = 100
export const SITE_SEARCH_URL_MAX_LENGTH = 2_048

export type SiteSearchProblem =
  | 'nameMissing'
  | 'nameTooLong'
  | 'keywordMissing'
  | 'keywordTooLong'
  | 'keywordSpaces'
  | 'keywordTaken'
  | 'urlTooLong'
  | 'urlInvalid'
  | 'urlQueryInSite'
  | 'urlNoQuery'

export interface SiteSearchProblems {
  name?: SiteSearchProblem
  keyword?: SiteSearchProblem
  url?: SiteSearchProblem
}

// The built-in engines' sites search them already, and @bookmarks, @history and @tabs search Hronaut's own lists, as
// in Chrome, so none of them can name a site search.
const RESERVED_KEYWORDS: ReadonlySet<string> = new Set([
  ...SEARCH_ENGINE_OPTIONS.map((engine) => engine.hostname),
  '@bookmarks',
  '@history',
  '@tabs'
])

const ID_PATTERN = /^[A-Za-z0-9-]{1,64}$/u

/**
 * Typed text as the address field reads it for a keyword, as Chrome cleans a typed keyword: in lower case, without
 * http:// or https://, www. and a closing slash, so that wikipedia.org and https://www.wikipedia.org/ name one site.
 */
export function cleanSiteSearchKeyword(text: string): string {
  return text.trim().toLowerCase().replace(/^https?:\/\//u, '').replace(/^www\./u, '').replace(/\/$/u, '')
}

// A shortcut as it is saved: cleaned until cleaning changes nothing more, so that www.www.wiki is saved as wiki, the
// text the address field matches it by, and reads back the same.
function savedKeyword(text: string): string {
  let keyword = text
  for (let cleaned = cleanSiteSearchKeyword(keyword); cleaned !== keyword; cleaned = cleanSiteSearchKeyword(keyword)) keyword = cleaned
  return keyword
}

// Whether the text is a web address once x stands for the terms, and whether its site stays the same whatever the
// terms are: an address such as https://%s.example/ puts them in the site's name.
function searchAddress(url: string): 'invalid' | 'queryInSite' | 'valid' {
  try {
    const first = new URL(url.replaceAll('%s', 'x'))
    const second = new URL(url.replaceAll('%s', 'y'))
    if ((first.protocol !== 'http:' && first.protocol !== 'https:') || !first.hostname) return 'invalid'
    return first.origin === second.origin ? 'valid' : 'queryInSite'
  } catch {
    return 'invalid'
  }
}

/** What keeps a site search from being saved, field by field; others are the saved ones, without the one edited. */
export function siteSearchProblems(draft: SiteSearchDraft, others: readonly SiteSearch[]): SiteSearchProblems {
  const problems: SiteSearchProblems = {}
  const name = draft.name.trim()
  if (!name) problems.name = 'nameMissing'
  else if (name.length > SITE_SEARCH_NAME_MAX_LENGTH) problems.name = 'nameTooLong'
  const keyword = savedKeyword(draft.keyword)
  if (!keyword) problems.keyword = 'keywordMissing'
  else if (keyword.length > SITE_SEARCH_KEYWORD_MAX_LENGTH) problems.keyword = 'keywordTooLong'
  else if (/\s/u.test(keyword)) problems.keyword = 'keywordSpaces'
  else if (RESERVED_KEYWORDS.has(keyword) || others.some((entry) => entry.keyword === keyword)) problems.keyword = 'keywordTaken'
  const url = draft.url.trim()
  const address = url.length > SITE_SEARCH_URL_MAX_LENGTH ? undefined : searchAddress(url)
  if (!address) problems.url = 'urlTooLong'
  else if (address === 'invalid') problems.url = 'urlInvalid'
  else if (address === 'queryInSite') problems.url = 'urlQueryInSite'
  else if (!url.includes('%s')) problems.url = 'urlNoQuery'
  return problems
}

/** The site search a draft without problems saves, with its shortcut cleaned and its name and address trimmed. */
export function siteSearchFromDraft(id: string, draft: SiteSearchDraft): SiteSearch {
  return { id, name: draft.name.trim(), keyword: savedKeyword(draft.keyword), url: draft.url.trim() }
}

export function isSiteSearchDraft(value: unknown): value is SiteSearchDraft {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const { name, keyword, url } = value as Record<string, unknown>
  return typeof name === 'string' && typeof keyword === 'string' && typeof url === 'string'
}

export function isSiteSearchId(value: unknown): value is string {
  return typeof value === 'string' && ID_PATTERN.test(value)
}

/** The saved site searches, without one that is malformed or repeats a shortcut, and no more than the limit. */
export function readSiteSearches(value: unknown): SiteSearch[] {
  if (!Array.isArray(value)) return []
  const entries: SiteSearch[] = []
  for (const candidate of value) {
    if (entries.length >= SITE_SEARCH_LIMIT) break
    if (!isSiteSearchDraft(candidate)) continue
    const { id } = candidate as unknown as Record<string, unknown>
    if (!isSiteSearchId(id) || entries.some((entry) => entry.id === id)) continue
    if (Object.keys(siteSearchProblems(candidate, entries)).length) continue
    entries.push(siteSearchFromDraft(id, candidate))
  }
  return entries
}

/**
 * Where a search goes: the search address with the terms in place of each %s, or the site's home page for no terms,
 * as a shortcut with nothing after it goes in Chrome.
 */
export function siteSearchUrl(url: string, query: string): string {
  const terms = query.trim()
  if (terms) return url.replaceAll('%s', encodeURIComponent(terms))
  return `${new URL(url.replaceAll('%s', 'x')).origin}/`
}
