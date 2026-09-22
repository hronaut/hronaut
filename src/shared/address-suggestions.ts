export type AddressSuggestionKind = 'bookmark' | 'history'
export type AddressSuggestionScope = 'all' | 'bookmarks' | 'history'

export interface AddressSuggestion {
  id: string
  kind: AddressSuggestionKind
  title: string
  url: string
  visitCount?: number
}

interface SuggestionBookmark {
  id: string
  title: string
  url: string
}

interface SuggestionHistoryEntry {
  id: string
  title: string
  url: string
  visitCount: number
}

export interface AddressSuggestionInput {
  query: string
  bookmarks: SuggestionBookmark[]
  history: SuggestionHistoryEntry[]
  limit?: number
}

export interface AddressSuggestionOverlayBounds {
  x: number
  y: number
  width: number
  maxHeight: number
}

export type AddressSuggestionOverlayTheme = Exclude<import('./types.js').ThemeName, 'system'>

export interface AddressSuggestionOverlayState {
  suggestions: AddressSuggestion[]
  selectedIndex: number
  theme: AddressSuggestionOverlayTheme
  locale: import('./locale.js').SupportedLocale
}

export interface AddressSuggestionOverlayRequest extends AddressSuggestionOverlayState {
  bounds: AddressSuggestionOverlayBounds
}

function parseQuery(rawQuery: string): { scope: AddressSuggestionScope; terms: string[] } {
  const query = rawQuery.trim()
  const match = query.match(/^@(bookmarks|history)(?:\s+|$)/i)
  const scope = (match?.[1]?.toLocaleLowerCase() ?? 'all') as AddressSuggestionScope
  const content = match ? query.slice(match[0].length) : query
  return {
    scope,
    terms: content.toLocaleLowerCase().split(/\s+/).filter(Boolean)
  }
}

function canonicalUrl(url: string): string {
  try {
    const parsed = new URL(url)
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') parsed.hash = ''
    return parsed.href
  } catch {
    return url
  }
}

function matches(title: string, url: string, terms: string[]): boolean {
  if (!terms.length) return true
  const searchable = `${title} ${url}`.toLocaleLowerCase()
  return terms.every((term) => searchable.includes(term))
}

function matchesHostnamePrefix(url: string, term: string): boolean {
  try {
    const hostname = new URL(url).hostname.toLocaleLowerCase().replace(/^www\./, '')
    return hostname.startsWith(term.replace(/^www\./, ''))
  } catch {
    return false
  }
}

export function buildLocalAddressSuggestions(input: AddressSuggestionInput): AddressSuggestion[] {
  const { scope, terms } = parseQuery(input.query)
  const limit = Math.max(1, Math.min(20, Math.trunc(input.limit ?? 8)))
  const suggestions: AddressSuggestion[] = []
  const seen = new Set<string>()

  const add = (suggestion: AddressSuggestion): void => {
    if (!matches(suggestion.title, suggestion.url, terms)) return
    const key = canonicalUrl(suggestion.url)
    if (seen.has(key)) return
    seen.add(key)
    suggestions.push(suggestion)
  }

  const addBookmarks = (): void => {
    for (const bookmark of input.bookmarks) {
      add({ id: `bookmark:${bookmark.id}`, kind: 'bookmark', title: bookmark.title, url: bookmark.url })
    }
  }
  const addHistory = (): void => {
    for (const entry of input.history) {
      add({
        id: `history:${entry.id}`,
        kind: 'history',
        title: entry.title,
        url: entry.url,
        visitCount: entry.visitCount
      })
    }
  }

  // Recent visits are the primary address-bar suggestions, including while
  // typing. Saved bookmarks fill the remaining slots without duplicating URLs.
  if (scope === 'all' || scope === 'history') addHistory()
  if (scope === 'all' || scope === 'bookmarks') addBookmarks()
  // Rank before applying the display limit so an often-used hostname cannot
  // disappear behind bookmarks or recent pages that merely mention it.
  const term = terms[0]
  if (terms.length === 1 && term) {
    const hostnameMatches: AddressSuggestion[] = []
    const otherMatches: AddressSuggestion[] = []
    for (const suggestion of suggestions) {
      const target = matchesHostnamePrefix(suggestion.url, term) ? hostnameMatches : otherMatches
      target.push(suggestion)
    }
    return [...hostnameMatches, ...otherMatches].slice(0, limit)
  }
  return suggestions.slice(0, limit)
}
