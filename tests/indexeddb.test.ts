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
