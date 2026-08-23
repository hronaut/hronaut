import type {
  BrowserStorageChange,
  BrowserStorageChangeCounts,
  BrowserStorageKind
} from './types.js'

export const MAX_STORAGE_CHANGES = 200
export const MAX_STORAGE_SNAPSHOT_ITEMS_PER_KIND = 200
export const MAX_STORAGE_CHANGE_VALUE_BYTES = 16 * 1024
export const MAX_STORAGE_CHANGE_VALUES_TOTAL_BYTES = 128 * 1024

export interface BrowserStorageSnapshotEntry {
  kind: BrowserStorageKind
  key: string
  fingerprint: string
  valueBytes: number
  valuePreview?: string
  valuePreviewTruncated?: boolean
  protected?: boolean
  domain?: string
  path?: string
  expires?: number
  secure?: boolean
  sameSite?: 'unspecified' | 'no_restriction' | 'lax' | 'strict'
  partitionKey?: string
}

export interface BrowserStorageSnapshot {
  origin: string
  capturedAt: string
  entries: BrowserStorageSnapshotEntry[]
  itemCounts: Record<BrowserStorageKind, number>
  truncated: boolean
}

export interface BrowserStorageSnapshotComparison {
  changes: BrowserStorageChange[]
  counts: BrowserStorageChangeCounts
  changeCount: number
  truncated: boolean
}

function entryIdentity(entry: BrowserStorageSnapshotEntry): string {
  return entry.kind === 'cookies'
    ? `${entry.kind}\u0000${entry.key}\u0000${entry.domain ?? ''}\u0000${entry.path ?? ''}\u0000${entry.partitionKey ?? ''}`
    : `${entry.kind}\u0000${entry.key}`
}

function attributes(entry: BrowserStorageSnapshotEntry): string {
  return JSON.stringify([
    entry.domain ?? null,
    entry.path ?? null,
    entry.expires ?? null,
    entry.secure ?? null,
    entry.sameSite ?? null,
    entry.protected ?? null,
    entry.partitionKey ?? null
  ])
}

function compareOrder(left: BrowserStorageSnapshotEntry, right: BrowserStorageSnapshotEntry): number {
  const kinds: BrowserStorageKind[] = ['local-storage', 'session-storage', 'cookies']
  return kinds.indexOf(left.kind) - kinds.indexOf(right.kind)
    || left.key.localeCompare(right.key)
    || (left.domain ?? '').localeCompare(right.domain ?? '')
    || (left.path ?? '').localeCompare(right.path ?? '')
}

export function compareBrowserStorageSnapshots(
  baseline: BrowserStorageSnapshot,
  current: BrowserStorageSnapshot,
  includeValues = false
): BrowserStorageSnapshotComparison {
  const before = new Map(baseline.entries.map((entry) => [entryIdentity(entry), entry]))
  const after = new Map(current.entries.map((entry) => [entryIdentity(entry), entry]))
  const changed: Array<{ before?: BrowserStorageSnapshotEntry; after?: BrowserStorageSnapshotEntry }> = []

  for (const [identity, entry] of before) {
    const next = after.get(identity)
    if (!next) changed.push({ before: entry })
    else if (entry.fingerprint !== next.fingerprint || attributes(entry) !== attributes(next)) {
      changed.push({ before: entry, after: next })
    }
  }
  for (const [identity, entry] of after) {
    if (!before.has(identity)) changed.push({ after: entry })
  }

  changed.sort((left, right) => compareOrder(left.after ?? left.before!, right.after ?? right.before!))
  const counts: BrowserStorageChangeCounts = { added: 0, updated: 0, removed: 0 }
  for (const item of changed) {
    if (!item.before) counts.added += 1
    else if (!item.after) counts.removed += 1
    else counts.updated += 1
  }

  let remainingValueBytes = MAX_STORAGE_CHANGE_VALUES_TOTAL_BYTES
  const changes = changed.slice(0, MAX_STORAGE_CHANGES).map(({ before: previous, after: next }): BrowserStorageChange => {
    const entry = next ?? previous!
    const type = !previous ? 'added' : !next ? 'removed' : 'updated'
    const result: BrowserStorageChange = {
      kind: entry.kind,
      type,
      key: entry.key,
      ...(entry.domain ? { domain: entry.domain } : {}),
      ...(entry.path ? { path: entry.path } : {}),
      ...(entry.protected ? { protected: true } : {}),
      ...(previous && next && attributes(previous) !== attributes(next) ? { attributesChanged: true } : {}),
      ...(previous?.kind === 'cookies' ? {
        beforeCookieAttributes: {
          ...(previous.expires !== undefined ? { expires: previous.expires } : {}),
          ...(previous.secure !== undefined ? { secure: previous.secure } : {}),
          ...(previous.sameSite !== undefined ? { sameSite: previous.sameSite } : {})
        }
      } : {}),
      ...(next?.kind === 'cookies' ? {
        afterCookieAttributes: {
          ...(next.expires !== undefined ? { expires: next.expires } : {}),
          ...(next.secure !== undefined ? { secure: next.secure } : {}),
          ...(next.sameSite !== undefined ? { sameSite: next.sameSite } : {})
        }
      } : {}),
      ...(previous ? { beforeValueBytes: previous.valueBytes } : {}),
      ...(next ? { afterValueBytes: next.valueBytes } : {})
    }

    const addValue = (position: 'before' | 'after', snapshot: BrowserStorageSnapshotEntry | undefined): void => {
      if (!includeValues || !snapshot || snapshot.protected || snapshot.valuePreview === undefined) return
      if (remainingValueBytes <= 0) {
        if (position === 'before') result.beforeValueTruncated = true
        else result.afterValueTruncated = true
        return
      }
      const buffer = Buffer.from(snapshot.valuePreview, 'utf8')
      const allowed = Math.min(MAX_STORAGE_CHANGE_VALUE_BYTES, remainingValueBytes)
      const value = buffer.subarray(0, allowed).toString('utf8')
      const returnedBytes = Buffer.byteLength(value, 'utf8')
      remainingValueBytes -= returnedBytes
      if (position === 'before') {
        result.beforeValue = value
        if (snapshot.valuePreviewTruncated || returnedBytes < buffer.length) result.beforeValueTruncated = true
      } else {
        result.afterValue = value
        if (snapshot.valuePreviewTruncated || returnedBytes < buffer.length) result.afterValueTruncated = true
      }
    }
    addValue('before', previous)
    addValue('after', next)
    return result
  })

  return {
    changes,
    counts,
    changeCount: changed.length,
    truncated: baseline.truncated || current.truncated || changed.length > MAX_STORAGE_CHANGES
  }
}
