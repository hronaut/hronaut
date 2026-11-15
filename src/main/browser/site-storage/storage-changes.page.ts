/** One stored item as a storage snapshot records it: its key, a fingerprint and the size of its value, and its start. */
export interface StorageSnapshotEntry {
  key: string
  fingerprint: string
  valueBytes: number
  valuePreview: string
}

/** What a storage snapshot records of one storage: how many items it holds, and the first ones by key. */
export interface StorageSnapshotItems {
  itemCount: number
  entries: StorageSnapshotEntry[]
}

/**
 * Runs in the page: its local and session storage, each as the number of items and, sorted by key, up to limit items
 * with a fingerprint and the byte size of each value and its first previewLimit characters.
 */
export function storageSnapshotInPage(limit: number, previewLimit: number): { local: StorageSnapshotItems; session: StorageSnapshotItems } {
  const fingerprint = (value: string): string => {
    let first = 2166136261
    let second = 2246822519
    for (let index = 0; index < value.length; index += 1) {
      const code = value.charCodeAt(index)
      first = Math.imul(first ^ code, 16777619)
      second = Math.imul(second ^ code, 3266489917)
    }
    return [first >>> 0, second >>> 0, value.length].join(':')
  }
  const read = (storage: Storage): StorageSnapshotItems => {
    const values: Array<[string, string]> = []
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index)
      if (key !== null) values.push([key, storage.getItem(key) ?? ''])
    }
    values.sort((left, right) => left[0].localeCompare(right[0]))
    return {
      itemCount: values.length,
      entries: values.slice(0, limit).map(([key, value]) => ({
        key,
        fingerprint: fingerprint(value),
        valueBytes: new TextEncoder().encode(value).byteLength,
        valuePreview: value.slice(0, previewLimit)
      }))
    }
  }
  return { local: read(localStorage), session: read(sessionStorage) }
}
