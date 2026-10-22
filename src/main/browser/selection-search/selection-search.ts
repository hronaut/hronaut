import { searchUrl, SEARCH_ENGINE_OPTIONS, type SearchEngineName } from '../../../shared/search-engine.js'

/** Chrome shows at most this many characters of the selection in the menu's label, then an ellipsis. */
const LABEL_TEXT_LIMIT = 50
/**
 * A search reads at most this much of the selection, so a selection of a whole long document neither stalls the menu
 * nor makes an address too long to open.
 */
const QUERY_SOURCE_LIMIT = 2048

/**
 * What Chrome's Search for a selection searches: the selected text with its runs of white space, line breaks included,
 * made single spaces. A selection of only white space, or one in a password field, searches nothing.
 */
export function selectionSearchQuery(selectionText: string, passwordField: boolean): string | undefined {
  if (passwordField) return undefined
  // The bound can split a character in two, so its first half goes too.
  const source = selectionText.length > QUERY_SOURCE_LIMIT
    ? selectionText.slice(0, QUERY_SOURCE_LIMIT).replace(/[\uD800-\uDBFF]$/u, '')
    : selectionText
  const query = source.replace(/\s+/gu, ' ').trim()
  return query || undefined
}

/**
 * The selection as the menu's label shows it: its first characters, as the person sees them, with an ellipsis when it
 * is longer, and with its ampersands shown rather than taken as access keys.
 */
export function selectionSearchLabelText(query: string): string {
  const characters = Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(query), (part) => part.segment)
  const shown = characters.length > LABEL_TEXT_LIMIT ? `${characters.slice(0, LABEL_TEXT_LIMIT).join('').trimEnd()}…` : query
  return shown.replaceAll('&', '&&')
}

/** The search engine's name as the menu shows it, such as Google; it is a name, so it is never translated. */
export function searchEngineLabel(engine: SearchEngineName): string {
  return (SEARCH_ENGINE_OPTIONS.find((candidate) => candidate.id === engine) ?? SEARCH_ENGINE_OPTIONS[0]).label
}

/** The search engine's results for the selection, which open in a new tab beside the page, as Chrome opens them. */
export function selectionSearchUrl(query: string, engine: SearchEngineName): string {
  return searchUrl(query, engine)
}
