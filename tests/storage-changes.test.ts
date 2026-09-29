import { describe, expect, it } from 'vitest'
import {
  MAX_STORAGE_CHANGE_VALUE_BYTES,
  MAX_STORAGE_CHANGE_VALUES_TOTAL_BYTES,
  compareBrowserStorageSnapshots,
  type BrowserStorageSnapshot
} from '../src/shared/storage-changes.js'

function snapshot(
  entries: BrowserStorageSnapshot['entries'],
  options: { capturedAt?: string; truncated?: boolean } = {}
): BrowserStorageSnapshot {
  return {
    origin: 'https://example.test',
    capturedAt: options.capturedAt ?? '2026-08-15T20:00:00.000Z',
    entries,
    itemCounts: {
      'local-storage': entries.filter((entry) => entry.kind === 'local-storage').length,
      'session-storage': entries.filter((entry) => entry.kind === 'session-storage').length,
      cookies: entries.filter((entry) => entry.kind === 'cookies').length
    },
    truncated: options.truncated ?? false
  }
}

describe('storage change comparison', () => {
  it.each(['added', 'updated', 'removed'] as const)('marks omitted snapshot previews as truncated for %s values', type => {
    const entry = (fingerprint: string) => ({
      kind: 'local-storage' as const, key: 'beyond-preview-budget', fingerprint,
      valueBytes: 100, valuePreviewTruncated: true
    })
    const baseline = snapshot(type === 'added' ? [] : [entry('before')])
    const current = snapshot(type === 'removed' ? [] : [entry('after')])
    const change = compareBrowserStorageSnapshots(baseline, current, true).changes[0]!
    expect(change.type).toBe(type)
    expect(change.beforeValue).toBeUndefined()
    expect(change.afterValue).toBeUndefined()
    expect(change.beforeValueTruncated).toBe(type === 'added' ? undefined : true)
    expect(change.afterValueTruncated).toBe(type === 'removed' ? undefined : true)
    const withoutValues = compareBrowserStorageSnapshots(baseline, current).changes[0]!
    expect(withoutValues.beforeValueTruncated).toBeUndefined()
    expect(withoutValues.afterValueTruncated).toBeUndefined()
  })

  it('does not expose preview completeness markers for protected cookies', () => {
    const entry = (fingerprint: string) => ({
      kind: 'cookies' as const, key: 'session', fingerprint, valueBytes: 100,
      protected: true, valuePreviewTruncated: true
    })
    const change = compareBrowserStorageSnapshots(snapshot([entry('before')]), snapshot([entry('after')]), true).changes[0]!
    expect(change.beforeValueTruncated).toBeUndefined()
    expect(change.afterValueTruncated).toBeUndefined()
    expect(change.beforeValue).toBeUndefined()
    expect(change.afterValue).toBeUndefined()
  })

  it('preserves Unicode prefixes in both sides of an updated value', () => {
    const entry = (value: string) => ({
      kind: 'local-storage' as const, key: 'unicode', fingerprint: value,
      valueBytes: Buffer.byteLength(value), valuePreview: value
    })
    const before = '€'.repeat(6_000)
    const prefix = 'a'.repeat(MAX_STORAGE_CHANGE_VALUE_BYTES - 1)
    const result = compareBrowserStorageSnapshots(snapshot([entry(before)]), snapshot([entry(prefix + '😀')]), true)
    expect(result.changes[0]).toMatchObject({
      beforeValue: '€'.repeat(5_461), beforeValueBytes: 18_000, beforeValueTruncated: true,
      afterValue: prefix, afterValueBytes: Buffer.byteLength(prefix + '😀'), afterValueTruncated: true
    })
  })

  it('keeps the shared before-and-after Unicode budget within its exact byte limit', () => {
    const entries = (value: string) => Array.from({ length: 5 }, (_, i) => ({
      kind: 'local-storage' as const, key: String(i), fingerprint: value,
      valueBytes: Buffer.byteLength(value), valuePreview: value
    }))
    const result = compareBrowserStorageSnapshots(snapshot(entries('€'.repeat(6_000))), snapshot(entries('界'.repeat(6_000))), true)
    const values = result.changes.flatMap(change => [change.beforeValue, change.afterValue]).filter((value): value is string => value !== undefined)
    expect(values.every(value => !value.includes('\ufffd'))).toBe(true)
    expect(values.every(value => Buffer.byteLength(value) <= MAX_STORAGE_CHANGE_VALUE_BYTES)).toBe(true)
    expect(values.reduce((bytes, value) => bytes + Buffer.byteLength(value), 0)).toBeLessThanOrEqual(MAX_STORAGE_CHANGE_VALUES_TOTAL_BYTES)
    expect(result.changes.at(-1)).toMatchObject({ beforeValueTruncated: true, afterValueTruncated: true })
  })

  it('groups added, updated, and removed state across all supported storage kinds', () => {
    const baseline = snapshot([
      { kind: 'local-storage', key: 'theme', fingerprint: 'old-theme', valueBytes: 4, valuePreview: 'dark' },
      { kind: 'session-storage', key: 'draft', fingerprint: 'old-draft', valueBytes: 5, valuePreview: 'draft' },
      { kind: 'cookies', key: 'session', domain: 'example.test', path: '/', protected: true, fingerprint: 'old-cookie', valueBytes: 12 }
    ])
    const current = snapshot([
      { kind: 'local-storage', key: 'feature', fingerprint: 'new-feature', valueBytes: 2, valuePreview: 'on' },
      { kind: 'local-storage', key: 'theme', fingerprint: 'new-theme', valueBytes: 5, valuePreview: 'light' },
      { kind: 'cookies', key: 'session', domain: 'example.test', path: '/', protected: true, secure: true, fingerprint: 'new-cookie', valueBytes: 13 }
    ])

    const result = compareBrowserStorageSnapshots(baseline, current)
    expect(result).toMatchObject({
      changeCount: 4,
      counts: { added: 1, updated: 2, removed: 1 },
      truncated: false
    })
    expect(result.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'local-storage', key: 'feature', type: 'added', afterValueBytes: 2 }),
      expect.objectContaining({ kind: 'local-storage', key: 'theme', type: 'updated', beforeValueBytes: 4, afterValueBytes: 5 }),
      expect.objectContaining({ kind: 'session-storage', key: 'draft', type: 'removed', beforeValueBytes: 5 }),
      expect.objectContaining({
        kind: 'cookies',
        key: 'session',
        type: 'updated',
        protected: true,
        attributesChanged: true,
        beforeCookieAttributes: {},
        afterCookieAttributes: { secure: true }
      })
    ]))
    expect(JSON.stringify(result)).not.toContain('dark')
    expect(JSON.stringify(result)).not.toContain('light')
  })

  it('returns bounded values only when requested and never exposes HttpOnly cookie values', () => {
    const largeBefore = 'a'.repeat(MAX_STORAGE_CHANGE_VALUE_BYTES + 100)
    const largeAfter = 'b'.repeat(MAX_STORAGE_CHANGE_VALUE_BYTES + 100)
    const baseline = snapshot([
      { kind: 'local-storage', key: 'large', fingerprint: 'before', valueBytes: largeBefore.length, valuePreview: largeBefore, valuePreviewTruncated: true },
      { kind: 'cookies', key: 'auth', domain: 'example.test', path: '/', protected: true, fingerprint: 'cookie-before', valueBytes: 13, valuePreview: 'server-secret' }
    ], { truncated: true })
    const current = snapshot([
      { kind: 'local-storage', key: 'large', fingerprint: 'after', valueBytes: largeAfter.length, valuePreview: largeAfter, valuePreviewTruncated: true },
      { kind: 'cookies', key: 'auth', domain: 'example.test', path: '/', protected: true, fingerprint: 'cookie-after', valueBytes: 14, valuePreview: 'new-server-secret' }
    ])

    const result = compareBrowserStorageSnapshots(baseline, current, true)
    const local = result.changes.find((change) => change.key === 'large')
    const cookie = result.changes.find((change) => change.key === 'auth')
    expect(local?.beforeValue).toHaveLength(MAX_STORAGE_CHANGE_VALUE_BYTES)
    expect(local?.beforeValueTruncated).toBe(true)
    expect(local?.afterValueTruncated).toBe(true)
    expect(cookie).not.toHaveProperty('beforeValue')
    expect(cookie).not.toHaveProperty('afterValue')
    expect(JSON.stringify(result)).not.toContain('server-secret')
    expect(result.truncated).toBe(true)
  })

  it('distinguishes same-name cookies by domain, path, and partition key', () => {
    const baseline = snapshot([
      { kind: 'cookies', key: 'state', domain: '.example.test', path: '/', partitionKey: 'one', fingerprint: 'one', valueBytes: 1 },
      { kind: 'cookies', key: 'state', domain: '.example.test', path: '/admin', partitionKey: 'two', fingerprint: 'two', valueBytes: 1 }
    ])
    const current = snapshot([
      { kind: 'cookies', key: 'state', domain: '.example.test', path: '/', partitionKey: 'one', fingerprint: 'changed', valueBytes: 2 },
      { kind: 'cookies', key: 'state', domain: '.example.test', path: '/admin', partitionKey: 'two', fingerprint: 'two', valueBytes: 1 }
    ])

    const result = compareBrowserStorageSnapshots(baseline, current)
    expect(result.changeCount).toBe(1)
    expect(result.changes[0]).toMatchObject({ key: 'state', path: '/', type: 'updated' })
  })
})
