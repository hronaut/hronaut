export interface SnapshotSearchMatch {
  index: number
  snippet: string
}

export interface SnapshotSearchResult {
  query: string
  caseSensitive: boolean
  sourceChars: number
  matches: SnapshotSearchMatch[]
  truncated: boolean
  caveats: string[]
}

export interface SnapshotSearchOptions {
  query: string
  caseSensitive?: boolean
  maxMatches?: number
  contextChars?: number
}

const MAX_QUERY_CHARS = 200
const MAX_SOURCE_CHARS = 100_000
const DEFAULT_MAX_MATCHES = 10
const MAX_MATCHES = 50
const DEFAULT_CONTEXT_CHARS = 140
const MAX_CONTEXT_CHARS = 500

export function searchSnapshot(snapshot: string, options: SnapshotSearchOptions): SnapshotSearchResult {
  const query = options.query.trim()
  if (!query) throw new TypeError('Snapshot search query cannot be empty')
  if (query.length > MAX_QUERY_CHARS) throw new TypeError(`Snapshot search query cannot exceed ${MAX_QUERY_CHARS} characters`)

  const source = snapshot.slice(0, MAX_SOURCE_CHARS)
  const caseSensitive = options.caseSensitive === true
  const maxMatches = Math.min(Math.max(Math.trunc(options.maxMatches ?? DEFAULT_MAX_MATCHES), 1), MAX_MATCHES)
  const contextChars = Math.min(Math.max(Math.trunc(options.contextChars ?? DEFAULT_CONTEXT_CHARS), 20), MAX_CONTEXT_CHARS)
  const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const matcher = new RegExp(escapedQuery, caseSensitive ? 'gu' : 'giu')
  const matches: SnapshotSearchMatch[] = []
  let truncated = false

  for (const match of source.matchAll(matcher)) {
    if (matches.length >= maxMatches) {
      truncated = true
      break
    }
    const index = match.index
    const start = Math.max(0, index - contextChars)
    const end = Math.min(source.length, index + match[0].length + contextChars)
    const compact = source.slice(start, end).replace(/\s+/g, ' ').trim()
    matches.push({
      index,
      snippet: `${start > 0 ? '…' : ''}${compact}${end < source.length ? '…' : ''}`
    })
  }

  return {
    query,
    caseSensitive,
    sourceChars: source.length,
    matches,
    truncated,
    caveats: [
      'Matches come from the same bounded, sanitized snapshot as browser_snapshot and may omit content outside its limit.',
      'Snippets contain page-authored visible text. Review them before sharing outside the trusted session.'
    ]
  }
}
