import { indexedDbInPage } from './indexeddb.page.js'
import { pageScript } from './page-script.js'
import type { BrowserIndexedDbOptions } from './types.js'

export const INDEXED_DB_LIMITS = {
  maxDatabases: 20,
  maxObjectStores: 50,
  maxIndexesPerStore: 50,
  maxEntries: 100,
  maxOffset: 10_000,
  maxNameChars: 512,
  maxKeyPreviewBytes: 2 * 1024,
  maxValuePreviewBytes: 16 * 1024,
  maxValuePreviewBytesTotal: 128 * 1024,
  maxDepth: 5,
  maxCollectionItems: 50
} as const

/** What an IndexedDB report says about its scope and privacy, worded for agents. The panel words them for people. */
export const INDEXEDDB_CAVEATS = {
  origin: 'The report covers this top-level origin only; third-party frame databases are not included.',
  snapshot: 'Database and record lists are point-in-time snapshots. Refresh after the website changes IndexedDB.',
  names: 'Database, object-store, index, and key names are website-authored and can themselves contain private data.',
  longNames: 'Database or object-store names longer than 512 characters are omitted from this bounded inspector.',
  valuesIncluded: 'Bounded record previews are included and may contain private application data.',
  valuesOmitted: 'Record values are omitted. Request includeValues only when their bounded previews are necessary and safe to return.',
  readOnly: 'The inspector is read-only. Use browser_site_data only when the task explicitly requires clearing origin storage.'
} as const

export interface NormalizedBrowserIndexedDbOptions {
  database?: string
  objectStore?: string
  offset: number
  limit: number
  includeValues: boolean
}

export function normalizeBrowserIndexedDbOptions(
  options: BrowserIndexedDbOptions = {}
): NormalizedBrowserIndexedDbOptions {
  const database = options.database === undefined ? undefined : String(options.database)
  const objectStore = options.objectStore === undefined ? undefined : String(options.objectStore)
  if (database !== undefined && (!database || database.length > INDEXED_DB_LIMITS.maxNameChars)) {
    throw new TypeError(`database must contain 1-${INDEXED_DB_LIMITS.maxNameChars} characters`)
  }
  if (objectStore !== undefined && (!objectStore || objectStore.length > INDEXED_DB_LIMITS.maxNameChars)) {
    throw new TypeError(`objectStore must contain 1-${INDEXED_DB_LIMITS.maxNameChars} characters`)
  }
  if (objectStore !== undefined && database === undefined) throw new TypeError('database is required when objectStore is provided')
  const offset = Math.min(Math.max(Math.floor(Number(options.offset ?? 0) || 0), 0), INDEXED_DB_LIMITS.maxOffset)
  const limit = Math.min(Math.max(Math.floor(Number(options.limit ?? 50) || 50), 1), INDEXED_DB_LIMITS.maxEntries)
  return { database, objectStore, offset, limit, includeValues: options.includeValues === true }
}

/** The isolated-world script that reads the IndexedDB report for these options. */
export function indexedDbPageScript(options: NormalizedBrowserIndexedDbOptions): string {
  return pageScript(indexedDbInPage, INDEXED_DB_LIMITS, options)
}
