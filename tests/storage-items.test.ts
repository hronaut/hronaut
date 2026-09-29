import { describe, expect, it } from 'vitest'
import {
  boundStorageItems,
  MAX_STORAGE_ITEMS,
  MAX_STORAGE_OUTPUT_TOTAL_BYTES,
  MAX_STORAGE_OUTPUT_VALUE_BYTES
} from '../src/main/browser/storage-items.js'

describe('bounded storage previews', () => {
  it.each(['ї', '€', '😀'])('preserves whole %s characters at the per-value boundary', character => {
    const exact = 'a'.repeat(MAX_STORAGE_OUTPUT_VALUE_BYTES - Buffer.byteLength(character)) + character
    expect(boundStorageItems([['exact', exact]], true)).toMatchObject({
      truncated: false, items: [{ value: exact, valueTruncated: undefined }]
    })
    const prefix = 'a'.repeat(MAX_STORAGE_OUTPUT_VALUE_BYTES - 1)
    const original = prefix + character
    expect(boundStorageItems([['cut', original]], true)).toMatchObject({
      truncated: true,
      items: [{ value: prefix, valueBytes: Buffer.byteLength(original), valueTruncated: true }]
    })
  })

  it('keeps multilingual values within the total budget and uses remaining bytes for whole characters', () => {
    const source: Array<[string, string]> = Array.from({ length: 8 }, (_, i) => [String(i), '€'.repeat(6_000)])
    source.push(['tail', '😀😀😀'], ['omitted', 'private-tail'])
    const report = boundStorageItems(source, true)
    expect(report.truncated).toBe(true)
    for (const item of report.items.slice(0, 8)) {
      expect(item.value).toBe('€'.repeat(5_461))
      expect(item.valueBytes).toBe(18_000)
      expect(item.valueTruncated).toBe(true)
    }
    expect(report.items[8]).toMatchObject({ value: '😀😀', valueTruncated: true })
    expect(report.items[9]).toMatchObject({ value: undefined, valueTruncated: true })
    expect(report.items.reduce((total, item) => total + Buffer.byteLength(item.value ?? ''), 0)).toBe(MAX_STORAGE_OUTPUT_TOTAL_BYTES)
  })

  it('preserves value opt-in and protected cookie metadata', () => {
    const input: Array<[string, string, { protected?: boolean }?]> = [
      ['secret', 'private-cookie', { protected: true }], ['ordinary', 'visible']
    ]
    expect(boundStorageItems(input, false).items.every(item => item.value === undefined)).toBe(true)
    expect(boundStorageItems(input, true, true)).toMatchObject({
      truncated: false,
      items: [{ key: 'secret', value: undefined, valueBytes: 14, protected: true }, { key: 'ordinary', value: 'visible' }]
    })
  })

  it('continues to bound the number of returned items', () => {
    const items: Array<[string, string]> = Array.from({ length: MAX_STORAGE_ITEMS + 1 }, (_, i) => [String(i), ''])
    const result = boundStorageItems(items, true)
    expect(result.items).toHaveLength(MAX_STORAGE_ITEMS)
    expect(result.truncated).toBe(true)
  })
})
