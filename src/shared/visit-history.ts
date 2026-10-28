import type { BrowserHistoryEntry, BrowserHistoryChanges } from './types.js'

/** The order the history lists its pages in: the last visited first, and pages visited at the same time by title. */
export function compareHistoryEntries(left: BrowserHistoryEntry, right: BrowserHistoryEntry): number {
  return right.visitedAt.localeCompare(left.visitedAt) || left.title.localeCompare(right.title)
}

/** The history with the changes made to it: the pages visited or retitled take their new place, the others leave. */
export function withHistoryChanges(entries: readonly BrowserHistoryEntry[], changes: BrowserHistoryChanges): BrowserHistoryEntry[] {
  const replaced = new Set([...changes.removedIds, ...changes.entries.map((entry) => entry.id)])
  return [...changes.entries, ...entries.filter((entry) => !replaced.has(entry.id))].sort(compareHistoryEntries)
}
