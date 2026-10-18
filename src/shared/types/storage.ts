export type BrowserStorageKind = 'local-storage' | 'session-storage' | 'cookies'
export type BrowserStorageAction = 'list' | 'get' | 'set' | 'delete' | 'clear'

export interface BrowserStorageItem {
  key: string
  value?: string
  valueBytes: number
  valueTruncated?: boolean
  protected?: boolean
  domain?: string
  path?: string
  expires?: number
  secure?: boolean
  sameSite?: 'unspecified' | 'no_restriction' | 'lax' | 'strict'
}

export interface BrowserStorageOptions {
  tabId?: string
  kind: BrowserStorageKind
  action?: BrowserStorageAction
  key?: string
  value?: string
  includeValues?: boolean
  /** Exact cookie domain from a listing; requires cookiePath and cookie delete. */
  cookieDomain?: string
  /** Exact cookie path from a listing; requires cookieDomain and cookie delete. */
  cookiePath?: string
}

export interface BrowserStorageResult {
  tabId: string
  url: string
  origin: string
  kind: BrowserStorageKind
  action: BrowserStorageAction
  itemCount: number
  items: BrowserStorageItem[]
  changed?: boolean
  truncated?: boolean
  note?: string
}

export type BrowserStorageUsageSource = 'chromium-quota' | 'storage-manager'

export interface BrowserStorageUsageBreakdown {
  storageType: string
  usage: number
}

export interface BrowserStorageUsageReport {
  tabId: string
  url: string
  origin: string
  capturedAt: string
  source: BrowserStorageUsageSource
  usage: number
  quota: number
  available: number
  usagePercent: number
  overrideActive: boolean
  breakdown: BrowserStorageUsageBreakdown[]
  breakdownAvailable: boolean
  caveats: string[]
}

export interface BrowserIndexedDbIndex {
  name: string
  keyPath: string | string[] | null
  unique: boolean
  multiEntry: boolean
}

export interface BrowserIndexedDbObjectStore {
  name: string
  keyPath: string | string[] | null
  autoIncrement: boolean
  indexes: BrowserIndexedDbIndex[]
  entryCount: number
}

export interface BrowserIndexedDbDatabase {
  name: string
  version: number
  objectStores?: BrowserIndexedDbObjectStore[]
}

export interface BrowserIndexedDbEntry {
  key: string
  keyType: string
  primaryKey: string
  keyTruncated?: boolean
  valueType: string
  valuePreview?: string
  valuePreviewBytes?: number
  valueTruncated?: boolean
}

export interface BrowserIndexedDbOptions {
  tabId?: string
  database?: string
  objectStore?: string
  offset?: number
  limit?: number
  includeValues?: boolean
}

export interface BrowserIndexedDbReport {
  tabId: string
  url: string
  origin: string
  databases: BrowserIndexedDbDatabase[]
  selectedDatabase?: BrowserIndexedDbDatabase
  selectedObjectStore?: string
  entries: BrowserIndexedDbEntry[]
  offset: number
  limit: number
  hasMore: boolean
  valuesIncluded: boolean
  truncated?: boolean
  caveats: string[]
}

export type BrowserStorageChangesAction = 'get' | 'baseline' | 'compare' | 'clear'
export type BrowserStorageChangeType = 'added' | 'updated' | 'removed'

export interface BrowserStorageCookieAttributes {
  expires?: number
  secure?: boolean
  sameSite?: 'unspecified' | 'no_restriction' | 'lax' | 'strict'
}

export interface BrowserStorageChange {
  kind: BrowserStorageKind
  type: BrowserStorageChangeType
  key: string
  domain?: string
  path?: string
  protected?: boolean
  attributesChanged?: boolean
  beforeCookieAttributes?: BrowserStorageCookieAttributes
  afterCookieAttributes?: BrowserStorageCookieAttributes
  beforeValue?: string
  afterValue?: string
  beforeValueBytes?: number
  afterValueBytes?: number
  beforeValueTruncated?: boolean
  afterValueTruncated?: boolean
}

export interface BrowserStorageChangeCounts {
  added: number
  updated: number
  removed: number
}

export interface BrowserStorageChangesOptions {
  tabId?: string
  action?: BrowserStorageChangesAction
  includeValues?: boolean
}

export interface BrowserStorageChangesReport {
  tabId: string
  url: string
  origin: string
  action: BrowserStorageChangesAction
  status: 'empty' | 'baseline' | 'compared'
  baselineAt?: string
  comparedAt?: string
  baselineItemCounts?: Record<BrowserStorageKind, number>
  currentItemCounts?: Record<BrowserStorageKind, number>
  changeCount: number
  counts: BrowserStorageChangeCounts
  changes: BrowserStorageChange[]
  valuesIncluded: boolean
  truncated?: boolean
  caveats: string[]
}
