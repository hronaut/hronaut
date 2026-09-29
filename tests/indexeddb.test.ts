import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import {
  INDEXED_DB_LIMITS,
  indexedDbPageScript,
  normalizeBrowserIndexedDbOptions
} from '../src/shared/indexeddb.js'

describe('IndexedDB inspection options', () => {
  it('normalizes paging and keeps values opt-in', () => {
    expect(normalizeBrowserIndexedDbOptions({ offset: -4, limit: 500 })).toEqual({
      database: undefined,
      objectStore: undefined,
      offset: 0,
      limit: INDEXED_DB_LIMITS.maxEntries,
      includeValues: false
    })
    expect(normalizeBrowserIndexedDbOptions({
      database: 'app',
      objectStore: 'settings',
      offset: 7.9,
      limit: 2.8,
      includeValues: true
    })).toEqual({ database: 'app', objectStore: 'settings', offset: 7, limit: 2, includeValues: true })
  })

  it('requires a database for an object store and bounds names', () => {
    expect(() => normalizeBrowserIndexedDbOptions({ objectStore: 'settings' })).toThrow('database is required')
    expect(() => normalizeBrowserIndexedDbOptions({ database: '' })).toThrow('database must contain')
    expect(() => normalizeBrowserIndexedDbOptions({ database: 'x'.repeat(INDEXED_DB_LIMITS.maxNameChars + 1) })).toThrow('database must contain')
  })

  it('serializes selected names into an isolated-world script without executable interpolation', () => {
    const database = `db'); globalThis.compromised = true; ('`
    const script = indexedDbPageScript(normalizeBrowserIndexedDbOptions({ database }))
    expect(script).toContain(JSON.stringify(database))
    expect(script).toContain('valuesIncluded: options.includeValues')
    expect(script).not.toContain('The inspector is read-only')
  })
})

describe('IndexedDB collection preview work', () => {
  it.each([
    ['Map', 50], ['Map', 10_000],
    ['Set', 50], ['Set', 10_000],
    ['Object', 50], ['Object', 10_000]
  ] as const)('bounds %s preview work for %i items', async (kind, count) => {
    let visited = 0
    const numbers = Array.from({ length: count }, (_, index) => index)
    const value = kind === 'Map'
      ? new Map(numbers.map((item) => [item, item]))
      : kind === 'Set' ? new Set(numbers) : Object.create({ inherited: 'excluded' }) as Record<string, number>
    if (value instanceof Map) {
      const entries = value.entries.bind(value)
      Object.defineProperty(value, 'entries', { value: function* () {
        for (const entry of entries()) { visited += 1; yield entry }
      } })
    } else if (value instanceof Set) {
      const values = value.values.bind(value)
      Object.defineProperty(value, 'values', { value: function* () {
        for (const item of values()) { visited += 1; yield item }
      } })
    }
    if (kind === 'Object') {
      for (const item of numbers) {
        Object.defineProperty(value, String(item), { enumerable: true, get() { visited += 1; return item } })
      }
    }
    const request = <T>(result: T) => {
      const pending = { result, onsuccess: undefined as (() => void) | undefined }
      queueMicrotask(() => pending.onsuccess?.())
      return pending
    }
    const store = {
      name: 'records',
      keyPath: null,
      autoIncrement: true,
      indexNames: [],
      count: () => request(1),
      openCursor: () => {
        const pending: {
          result: { key: number; primaryKey: number; value: typeof value; continue(): void } | null
          onsuccess?: () => void
        } = {
          result: {
            key: 1,
            primaryKey: 1,
            value,
            continue() {
              pending.result = null
              queueMicrotask(() => pending.onsuccess?.())
            }
          }
        }
        queueMicrotask(() => pending.onsuccess?.())
        return pending
      }
    }
    let closed = false
    const database = {
      name: 'app',
      version: 1,
      objectStoreNames: ['records'],
      transaction: () => ({ objectStore: () => store }),
      close: () => { closed = true }
    }
    const report = await runInNewContext(indexedDbPageScript(normalizeBrowserIndexedDbOptions({
      database: 'app', objectStore: 'records', includeValues: true
    })), {
      indexedDB: { databases: async () => [{ name: 'app', version: 1 }], open: () => request(database) },
      Map, Set, Blob, TextEncoder, TextDecoder
    }) as { entries: Array<{ valuePreview: string; valueTruncated?: boolean }> }
    expect(closed).toBe(true)
    expect(visited).toBe(INDEXED_DB_LIMITS.maxCollectionItems)
    expect(report.entries).toHaveLength(1)
    const expected = numbers.slice(0, INDEXED_DB_LIMITS.maxCollectionItems)
    expect(JSON.parse(report.entries[0]!.valuePreview)).toEqual(kind === 'Map'
      ? { type: 'Map', entries: expected.map((item) => [item, item]) }
      : kind === 'Set' ? { type: 'Set', values: expected } : Object.fromEntries(expected.map((item) => [item, item])))
    expect(Boolean(report.entries[0]!.valueTruncated)).toBe(count > INDEXED_DB_LIMITS.maxCollectionItems)
  })
})
