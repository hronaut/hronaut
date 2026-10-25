import { SEARCH_ENGINE_OPTIONS, searchUrl, type SearchEngineName } from '../../shared/search-engine.js'

/**
 * A search engine the address field searches by its keyword, as Chrome's address bar does: the engine's site, typed or
 * filled in, offers Tab to search it, and Tab, or a space after the site, turns the field into a search box for that
 * engine. Each built-in engine's site is its keyword, as in Chrome.
 */
export interface AddressKeyword {
  engine: SearchEngineName
  /** The engine's name, which the field's chip shows. */
  label: string
  /** The site that names the engine, such as google.com. */
  keyword: string
}

const KEYWORDS: readonly AddressKeyword[] = SEARCH_ENGINE_OPTIONS.map((engine) => ({
  engine: engine.id,
  label: engine.label,
  keyword: engine.hostname
}))

/**
 * The engine the text names, read as Chrome reads a typed keyword: in any case, with or without http:// or https://,
 * www. and a closing slash. Other text names none.
 */
export function addressKeyword(text: string): AddressKeyword | undefined {
  const site = text.trim().toLowerCase().replace(/^https?:\/\//u, '').replace(/^www\./u, '').replace(/\/$/u, '')
  return KEYWORDS.find((candidate) => candidate.keyword === site)
}

/** Where a keyword search goes: the engine's results for the query, or its home page for an empty one. */
export function keywordSearchTarget(keyword: AddressKeyword, query: string): string {
  const terms = query.trim()
  if (terms) return searchUrl(terms, keyword.engine)
  return `${new URL(searchUrl('', keyword.engine)).origin}/`
}
