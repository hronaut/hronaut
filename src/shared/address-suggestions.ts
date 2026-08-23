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

export type AddressSuggestionOverlayTheme = 'light' | 'dark' | 'cyberpunk'

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

export function buildLocalAddressSuggestions(input: AddressSuggestionInput): AddressSuggestion[] {
  const { scope, terms } = parseQuery(input.query)
  const limit = Math.max(1, Math.min(20, Math.trunc(input.limit ?? 8)))
  const suggestions: AddressSuggestion[] = []
  const seen = new Set<string>()

  const add = (suggestion: AddressSuggestion): void => {
    if (suggestions.length >= limit || !matches(suggestion.title, suggestion.url, terms)) return
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

  // With no query, behave like a browser's address bar: show recent visits
  // immediately, then saved bookmarks that are not already represented. Once
  // the user types, keep bookmarks first as an explicit saved destination.
  if (scope === 'all' && !terms.length) {
    addHistory()
    addBookmarks()
  } else {
    if (scope === 'all' || scope === 'bookmarks') addBookmarks()
    if (scope === 'all' || scope === 'history') addHistory()
  }
  return suggestions
}
