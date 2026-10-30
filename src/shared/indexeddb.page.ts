import type { INDEXED_DB_LIMITS, NormalizedBrowserIndexedDbOptions } from './indexeddb.js'
import type { BrowserIndexedDbEntry, BrowserIndexedDbObjectStore, BrowserIndexedDbReport } from './types.js'

/** The IndexedDB report as the page reads it; main adds the tab, address, origin and caveats. */
export type IndexedDbPageReport = Omit<BrowserIndexedDbReport, 'tabId' | 'url' | 'origin' | 'caveats'>

type TypedArrayView = ArrayBufferView & { length: number; subarray(begin: number, end: number): ArrayLike<number | bigint> }

/**
 * Runs in the IndexedDB isolated world: lists the origin's databases and, when asked, one database's object stores and
 * one store's records, each previewed within the byte and depth limits. It only reads, and closes the database it opened.
 */
export async function indexedDbInPage(limits: typeof INDEXED_DB_LIMITS, options: NormalizedBrowserIndexedDbOptions): Promise<IndexedDbPageReport> {
  if (!globalThis.indexedDB || typeof globalThis.indexedDB.databases !== 'function') {
    throw new Error('IndexedDB database discovery is unavailable for this page.')
  }
  const requestResult = <T>(request: IDBRequest<T>): Promise<T> => new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error('IndexedDB request failed.'))
  })
  const boundedName = (value: unknown): string => String(value ?? '').slice(0, limits.maxNameChars)
  const valueType = (value: unknown): string => {
    if (value === null) return 'null'
    if (Array.isArray(value)) return 'array'
    const tag = Object.prototype.toString.call(value).slice(8, -1)
    return tag || typeof value
  }
  const takePreviewItems = <T>(iterable: Iterable<T>): T[] => {
    const items: T[] = []
    for (const item of iterable) {
      items.push(item)
      if (items.length >= limits.maxCollectionItems) break
    }
    return items
  }
  const normalize = (value: unknown, depth: number, seen: WeakSet<object>, state: { truncated: boolean }): unknown => {
    if (typeof value === 'number' && !Number.isFinite(value)) return '[' + String(value) + ']'
    if (value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
      if (typeof value === 'string' && value.length > 4096) {
        state.truncated = true
        return value.slice(0, 4096) + '…'
      }
      return value
    }
    if (typeof value === 'undefined') return '[undefined]'
    if (typeof value === 'bigint') return String(value) + 'n'
    if (typeof value === 'symbol') return '[Symbol]'
    if (typeof value === 'function') return '[Function]'
    if (depth >= limits.maxDepth) {
      state.truncated = true
      return '[' + valueType(value) + ']'
    }
    if (seen.has(value)) {
      state.truncated = true
      return '[Repeated reference]'
    }
    seen.add(value)
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? '[Invalid Date]' : value.toISOString()
    if (value instanceof RegExp) return {
      type: 'RegExp', source: normalize(value.source, depth + 1, seen, state), flags: value.flags
    }
    if (value instanceof Blob) return { type: valueType(value), size: value.size, mimeType: boundedName(value.type) }
    if (value instanceof ArrayBuffer) return { type: 'ArrayBuffer', byteLength: value.byteLength }
    if (ArrayBuffer.isView(value)) {
      const values = value instanceof DataView ? [] : Array.from(
        (value as TypedArrayView).subarray(0, limits.maxCollectionItems),
        (item) => normalize(item, depth + 1, seen, state)
      )
      if ((value as TypedArrayView).length > values.length) state.truncated = true
      return { type: valueType(value), byteLength: value.byteLength, values }
    }
    if (value instanceof Map) {
      const entries = takePreviewItems(value.entries())
        .map(([key, item]) => [normalize(key, depth + 1, seen, state), normalize(item, depth + 1, seen, state)])
      if (value.size > entries.length) state.truncated = true
      return { type: 'Map', entries }
    }
    if (value instanceof Set) {
      const values = takePreviewItems(value.values())
        .map((item) => normalize(item, depth + 1, seen, state))
      if (value.size > values.length) state.truncated = true
      return { type: 'Set', values }
    }
    if (Array.isArray(value)) {
      const values = value.slice(0, limits.maxCollectionItems)
        .map((item) => normalize(item, depth + 1, seen, state))
      if (value.length > values.length) state.truncated = true
      return values
    }
    const output: Record<string, unknown> = Object.create(null)
    let inspected = 0
    for (const key in value) {
      if (!Object.hasOwn(value, key)) continue
      if (inspected >= limits.maxCollectionItems) {
        state.truncated = true
        break
      }
      inspected += 1
      if (key.length > limits.maxNameChars) {
        state.truncated = true
        continue
      }
      output[key] = normalize((value as Record<string, unknown>)[key], depth + 1, seen, state)
    }
    return output
  }
  const preview = (value: unknown, maxBytes: number): { text: string; bytes: number; truncated: boolean } => {
    const state = { truncated: false }
    let text: string | undefined
    try {
      text = JSON.stringify(normalize(value, 0, new WeakSet(), state))
    } catch {
      text = JSON.stringify('[' + valueType(value) + ']')
      state.truncated = true
    }
    if (text === undefined) text = JSON.stringify('[undefined]')
    const encoded = new TextEncoder().encode(text)
    let returned = encoded.byteLength > maxBytes
      ? new TextDecoder().decode(encoded.slice(0, maxBytes))
      : text
    while (new TextEncoder().encode(returned).byteLength > maxBytes) returned = returned.slice(0, -1)
    return {
      text: returned,
      bytes: encoded.byteLength,
      truncated: state.truncated || encoded.byteLength > maxBytes
    }
  }
  const rawDatabases = await globalThis.indexedDB.databases()
  const namedDatabases = rawDatabases
    .filter((database): database is IDBDatabaseInfo & { name: string } => typeof database.name === 'string' && database.name.length > 0)
    .sort((left, right) => left.name.localeCompare(right.name))
  const usableDatabases = namedDatabases.filter((database) => database.name.length <= limits.maxNameChars)
  const databases = usableDatabases.slice(0, limits.maxDatabases).map((database) => ({
    name: boundedName(database.name),
    version: Number(database.version || 0)
  }))
  const report: IndexedDbPageReport = {
    databases,
    entries: [],
    offset: options.offset,
    limit: options.limit,
    hasMore: false,
    valuesIncluded: options.includeValues,
    truncated: namedDatabases.length > databases.length
  }
  if (!options.database) return report
  if (!usableDatabases.some((database) => database.name === options.database)) {
    throw new Error('IndexedDB database not found: ' + options.database)
  }
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = globalThis.indexedDB.open(options.database!)
    let settled = false
    const fail = (error: unknown) => {
      if (settled) return
      settled = true
      reject(error)
    }
    request.onsuccess = () => {
      if (settled) {
        request.result.close()
        return
      }
      settled = true
      resolve(request.result)
    }
    request.onerror = () => fail(request.error || new Error('Could not open IndexedDB database.'))
    request.onupgradeneeded = () => {
      request.transaction?.abort()
      fail(new Error('IndexedDB database changed while it was being inspected. Refresh and try again.'))
    }
    request.onblocked = () => fail(new Error('IndexedDB database is blocked by another page. Close pending database upgrades and try again.'))
  })
  try {
    const storeNames = Array.from(database.objectStoreNames).sort()
    const selectedStoreNames = storeNames
      .filter((storeName) => storeName.length <= limits.maxNameChars)
      .slice(0, limits.maxObjectStores)
    const objectStores: BrowserIndexedDbObjectStore[] = []
    for (const storeName of selectedStoreNames) {
      const transaction = database.transaction(storeName, 'readonly')
      const store = transaction.objectStore(storeName)
      const indexes = Array.from(store.indexNames).sort().slice(0, limits.maxIndexesPerStore).map((indexName) => {
        const index = store.index(indexName)
        return {
          name: boundedName(index.name),
          keyPath: index.keyPath,
          unique: index.unique,
          multiEntry: index.multiEntry
        }
      })
      const entryCount = await requestResult(store.count())
      objectStores.push({
        name: boundedName(store.name),
        keyPath: store.keyPath,
        autoIncrement: store.autoIncrement,
        indexes,
        entryCount
      })
    }
    report.selectedDatabase = {
      name: boundedName(database.name),
      version: Number(database.version),
      objectStores
    }
    if (storeNames.length > selectedStoreNames.length) report.truncated = true
    if (!options.objectStore) return report
    if (!storeNames.includes(options.objectStore)) {
      throw new Error('IndexedDB object store not found: ' + options.objectStore)
    }
    report.selectedObjectStore = options.objectStore
    const transaction = database.transaction(options.objectStore, 'readonly')
    const store = transaction.objectStore(options.objectStore)
    let remainingValueBytes: number = limits.maxValuePreviewBytesTotal
    let skipped = 0
    await new Promise<void>((resolve, reject) => {
      const request = store.openCursor()
      request.onerror = () => reject(request.error || new Error('Could not read IndexedDB records.'))
      request.onsuccess = () => {
        const cursor = request.result
        if (!cursor) {
          resolve()
          return
        }
        if (skipped < options.offset) {
          skipped += 1
          cursor.continue()
          return
        }
        if (report.entries.length >= options.limit) {
          report.hasMore = true
          resolve()
          return
        }
        const key = preview(cursor.key, limits.maxKeyPreviewBytes)
        const primaryKey = preview(cursor.primaryKey, limits.maxKeyPreviewBytes)
        const entry: BrowserIndexedDbEntry = {
          key: key.text,
          keyType: valueType(cursor.key),
          primaryKey: primaryKey.text,
          valueType: valueType(cursor.value),
          ...(key.truncated || primaryKey.truncated ? { keyTruncated: true } : {})
        }
        if (options.includeValues && remainingValueBytes > 0) {
          const value = preview(cursor.value, Math.min(limits.maxValuePreviewBytes, remainingValueBytes))
          entry.valuePreview = value.text
          entry.valuePreviewBytes = new TextEncoder().encode(value.text).byteLength
          if (value.truncated) entry.valueTruncated = true
          remainingValueBytes -= new TextEncoder().encode(value.text).byteLength
        } else if (options.includeValues) {
          entry.valueTruncated = true
        }
        report.entries.push(entry)
        cursor.continue()
      }
    })
    return report
  } finally {
    database.close()
  }
}
