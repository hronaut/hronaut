import { SEARCH_ENGINE_OPTIONS } from '../../shared/search-engine.js'
import { cleanSiteSearchKeyword, siteSearchUrl, type SiteSearch } from '../../shared/site-search.js'

/**
 * A search engine the address field searches by its keyword, as Chrome's address bar does: the engine's site, typed or
 * filled in, offers Tab to search it, and Tab, or a space after the site, turns the field into a search box for that
 * engine. Each built-in engine's site is its keyword, as in Chrome, and each site search in Settings has its shortcut.
 */
export interface AddressKeyword {
  /** The built-in engine's id, or the site search's. */
  id: string
  /** The engine's name, which the field's chip shows. */
  label: string
  /** What names the engine: a built-in engine's site, such as google.com, or a site search's shortcut. */
  keyword: string
  /** The search address, with %s where the search terms go. */
  url: string
}

const ENGINE_KEYWORDS: readonly AddressKeyword[] = SEARCH_ENGINE_OPTIONS.map((engine) => ({
  id: engine.id,
  label: engine.label,
  keyword: engine.hostname,
  url: engine.template
}))

/**
 * The engine the text names, read as Chrome reads a typed keyword: in any case, with or without http:// or https://,
 * www. and a closing slash. A built-in engine's site comes before a site search, which cannot take one anyway. Other
 * text names none.
 */
export function addressKeyword(text: string, siteSearches: readonly SiteSearch[] = []): AddressKeyword | undefined {
  const typed = cleanSiteSearchKeyword(text)
  if (!typed) return undefined
  const engine = ENGINE_KEYWORDS.find((candidate) => candidate.keyword === typed)
  if (engine) return engine
  const site = siteSearches.find((candidate) => candidate.keyword === typed)
  return site ? { id: site.id, label: site.name, keyword: site.keyword, url: site.url } : undefined
}

/** Where a keyword search goes: the engine's results for the query, or its home page for an empty one. */
export function keywordSearchTarget(keyword: AddressKeyword, query: string): string {
  return siteSearchUrl(keyword.url, query)
}
