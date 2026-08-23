import { describe, expect, it } from 'vitest'
import {
  MAX_STORAGE_CHANGE_VALUE_BYTES,
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
