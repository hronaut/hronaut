import type { BrowserHistoryEntry, BrowserHistoryChanges } from './types.js'

const MAX_HISTORY_URL = 4_096
const MAX_HISTORY_INPUT_URL = 32_768

/**
 * A page's address as the history keeps it, without its fragment or sign-in details, or null for an address the history
 * leaves out: one that is not a web page's, or is too long.
 */
export function normalizeHistoryUrl(value: string): string | null {
  const fragmentStart = value.indexOf('#')
  const address = fragmentStart < 0 ? value : value.slice(0, fragmentStart)
  if (!address || address.length > MAX_HISTORY_INPUT_URL) return null
  try {
    const url = new URL(address)
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || !url.hostname) return null
    url.username = ''
    url.password = ''
    return url.href.length <= MAX_HISTORY_URL ? url.href : null
  } catch {
    return null
  }
}

/** The order the history lists its pages in: the last visited first, and pages visited at the same time by title. */
export function compareHistoryEntries(left: BrowserHistoryEntry, right: BrowserHistoryEntry): number {
  return right.visitedAt.localeCompare(left.visitedAt) || left.title.localeCompare(right.title)
}

/** The history with the changes made to it: the pages visited or retitled take their new place, the others leave. */
export function withHistoryChanges(entries: readonly BrowserHistoryEntry[], changes: BrowserHistoryChanges): BrowserHistoryEntry[] {
  const replaced = new Set([...changes.removedIds, ...changes.entries.map((entry) => entry.id)])
  return [...changes.entries, ...entries.filter((entry) => !replaced.has(entry.id))].sort(compareHistoryEntries)
}
