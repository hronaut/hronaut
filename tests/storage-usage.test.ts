import { describe, expect, it } from 'vitest'
import {
  buildBrowserStorageUsageReport,
  normalizeStorageUsageBreakdown,
  storageManagerUsageBreakdown
} from '../src/shared/storage-usage.js'

describe('storage usage reports', () => {
  it('bounds, merges, and sorts browser-defined categories', () => {
    expect(normalizeStorageUsageBreakdown([
      { storageType: 'indexeddb', usage: 120.4 },
      { storageType: 'cache_storage', usage: 300 },
      { storageType: 'indexeddb', usage: 80 },
      { storageType: '', usage: 999 },
      { storageType: 'ignored', usage: Number.NaN }
    ])).toEqual([
      { storageType: 'cache_storage', usage: 300 },
      { storageType: 'indexeddb', usage: 200 }
    ])
  })

  it('normalizes Storage Manager usage details for the fallback report', () => {
    expect(storageManagerUsageBreakdown({ caches: 64, indexedDB: 128, invalid: 'nope' })).toEqual([
      { storageType: 'indexedDB', usage: 128 },
      { storageType: 'caches', usage: 64 }
    ])
  })

  it('derives safe totals and documents read-only privacy boundaries', () => {
    const report = buildBrowserStorageUsageReport({
      tabId: 'tab-1',
      url: 'https://example.test/',
      origin: 'https://example.test',
      source: 'chromium-quota',
      raw: {
        usage: 250,
        quota: 1_000,
        overrideActive: true,
        usageBreakdown: [{ storageType: 'indexeddb', usage: 250 }]
      }
    })
    expect(report).toMatchObject({
      usage: 250,
      quota: 1_000,
      available: 750,
      usagePercent: 25,
      overrideActive: true,
      breakdownAvailable: true
    })
    expect(report.caveats.join(' ')).toContain('Keys, values, filenames, and response bodies are never included')
    expect(report.caveats.join(' ')).toContain('read-only')
  })
})
