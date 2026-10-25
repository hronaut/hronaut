export type AddressSuggestionKind = 'bookmark' | 'history' | 'tab'
export type AddressSuggestionScope = 'all' | 'bookmarks' | 'history' | 'tabs'

export interface AddressSuggestion {
  id: string
  kind: AddressSuggestionKind
  title: string
  url: string
  visitCount?: number
  /**
   * The open tab that shows this page, which Switch to this tab goes to, as in Chrome: a bookmark or visit open in
   * another tab, or the tab itself for an open tab found with @tabs.
   */
  openTabId?: string
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

interface SuggestionTab {
  id: string
  title: string
  url: string
}

export interface AddressSuggestionInput {
  query: string
  bookmarks: SuggestionBookmark[]
  history: SuggestionHistoryEntry[]
  /** The open tabs other than the one shown, in the tab strip's order. */
  tabs?: SuggestionTab[]
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
  sessionId: number
  suggestions: AddressSuggestion[]
  selectedIndex: number
  /** Tab in the address field went on from the highlighted row to its Switch to this tab button. */
  selectedAction?: 'switch-tab'
  theme: AddressSuggestionOverlayTheme
  locale: import('./locale.js').SupportedLocale
}

export interface AddressSuggestionOverlayRequest extends AddressSuggestionOverlayState {
  bounds: AddressSuggestionOverlayBounds
}

export interface AddressSuggestionSelection {
  sessionId: number
  suggestionId: string
  /** A middle-click on the row opens it in a new tab behind the current one, as in Chrome. */
  disposition?: 'new-background-tab'
  /** A click on the row's Switch to this tab button. */
  action?: 'switch-tab'
}

/** The longest address and title a row of the suggestions view takes; a longer one is shortened for the view. */
export const ADDRESS_SUGGESTION_URL_MAX_LENGTH = 32_768
export const ADDRESS_SUGGESTION_TITLE_MAX_LENGTH = 4_096

function parseQuery(rawQuery: string): { scope: AddressSuggestionScope; terms: string[] } {
  const query = rawQuery.trim()
  const match = query.match(/^@(bookmarks|history|tabs)(?:\s+|$)/i)
  const scope = (match?.[1]?.toLocaleLowerCase() ?? 'all') as AddressSuggestionScope
  const content = match ? query.slice(match[0].length) : query
  return {
    scope,
    terms: content.toLocaleLowerCase().split(/\s+/).filter(Boolean)
  }
}

function canonicalUrl(url: string, kind: AddressSuggestionKind): string {
  try {
    const parsed = new URL(url)
    // Visits represent pages; saved bookmarks can target distinct page sections.
    if (kind === 'history' && (parsed.protocol === 'http:' || parsed.protocol === 'https:')) parsed.hash = ''
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

/** The source a query limits the suggestions to, such as @tabs for the open tabs. */
export function addressSuggestionScope(query: string): AddressSuggestionScope {
  return parseQuery(query).scope
}

/** The id of the history entry a history suggestion shows; none for a bookmark or an open tab. */
export function historySuggestionEntryId(suggestion: AddressSuggestion): string | undefined {
  return suggestion.kind === 'history' ? suggestion.id.slice('history:'.length) : undefined
}

/** Whether a bookmark or visit row has a Switch to this tab button; an open tab's own row switches to it. */
export function hasSwitchToTabButton(suggestion: AddressSuggestion | undefined): suggestion is AddressSuggestion & { openTabId: string } {
  return suggestion !== undefined && suggestion.kind !== 'tab' && suggestion.openTabId !== undefined
}

export function buildLocalAddressSuggestions(input: AddressSuggestionInput): AddressSuggestion[] {
  const { scope, terms } = parseQuery(input.query)
  const limit = Math.max(1, Math.min(20, Math.trunc(input.limit ?? 8)))
  const suggestions: AddressSuggestion[] = []
  const seen = new Set<string>()

  // The first other tab that shows each page, by the address a bookmark or a visit is matched with.
  const tabs = input.tabs ?? []
  const openTabs = (kind: 'bookmark' | 'history'): Map<string, string> => {
    const byUrl = new Map<string, string>()
    for (const tab of tabs) {
      const key = canonicalUrl(tab.url, kind)
      if (!byUrl.has(key)) byUrl.set(key, tab.id)
    }
    return byUrl
  }
  const openTabsByUrl = { bookmark: openTabs('bookmark'), history: openTabs('history') }

  const add = (suggestion: AddressSuggestion): void => {
    if (!matches(suggestion.title, suggestion.url, terms)) return
    // Each open tab is a row of its own; a bookmark or a visit is one row for each page.
    const key = suggestion.kind === 'tab' ? suggestion.id : canonicalUrl(suggestion.url, suggestion.kind)
    if (seen.has(key)) return
    seen.add(key)
    const openTabId = suggestion.kind === 'tab' ? undefined : openTabsByUrl[suggestion.kind].get(key)
    suggestions.push(openTabId ? { ...suggestion, openTabId } : suggestion)
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

  // As Chrome's @tabs, the open tabs, each of which the row switches to.
  const addTabs = (): void => {
    for (const tab of tabs) add({ id: `tab:${tab.id}`, kind: 'tab', title: tab.title, url: tab.url, openTabId: tab.id })
  }

  // Recent visits are the primary address-bar suggestions, including while
  // typing. Saved bookmarks fill the remaining slots without duplicating URLs.
  if (scope === 'all' || scope === 'history') addHistory()
  if (scope === 'all' || scope === 'bookmarks') addBookmarks()
  if (scope === 'tabs') addTabs()
  // Rank before applying the display limit. Keep visited pages ahead of
  // bookmarks while preferring hostname matches within each source.
  const term = terms[0]
  if (terms.length === 1 && term) {
    const visitedHostnameMatches: AddressSuggestion[] = []
    const otherVisits: AddressSuggestion[] = []
    const bookmarkedHostnameMatches: AddressSuggestion[] = []
    const otherBookmarks: AddressSuggestion[] = []
    for (const suggestion of suggestions) {
      const hostnameMatches = matchesHostnamePrefix(suggestion.url, term)
      // Open tabs, found only with @tabs, are ranked as visits are.
      const target = suggestion.kind === 'bookmark'
        ? hostnameMatches ? bookmarkedHostnameMatches : otherBookmarks
        : hostnameMatches ? visitedHostnameMatches : otherVisits
      target.push(suggestion)
    }
    return [...visitedHostnameMatches, ...otherVisits, ...bookmarkedHostnameMatches, ...otherBookmarks].slice(0, limit)
  }
  return suggestions.slice(0, limit)
}
