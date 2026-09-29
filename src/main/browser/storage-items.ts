import { utf8Prefix } from '../../shared/utf8.js'
import type { BrowserStorageItem } from '../../shared/types.js'

export const MAX_STORAGE_ITEMS = 200
export const MAX_STORAGE_OUTPUT_VALUE_BYTES = 16 * 1024
export const MAX_STORAGE_OUTPUT_TOTAL_BYTES = 128 * 1024

export function boundStorageItems(
  items: Array<[string, string, Omit<BrowserStorageItem, 'key' | 'value' | 'valueBytes'>?]>,
  includeValues: boolean,
  protectValues = false
): { items: BrowserStorageItem[]; truncated: boolean } {
  let remainingBytes = MAX_STORAGE_OUTPUT_TOTAL_BYTES
  let truncated = items.length > MAX_STORAGE_ITEMS
  const bounded = items.slice(0, MAX_STORAGE_ITEMS).map(([key, value, metadata]) => {
    const valueBytes = Buffer.byteLength(value, 'utf8')
    const protectedValue = protectValues && metadata?.protected === true
    let returnedValue: string | undefined
    let valueTruncated = false
    if (includeValues && !protectedValue && (remainingBytes > 0 || valueBytes === 0)) {
      const maxBytes = Math.min(MAX_STORAGE_OUTPUT_VALUE_BYTES, remainingBytes)
      const buffer = Buffer.from(value, 'utf8')
      returnedValue = utf8Prefix(buffer, maxBytes)
      valueTruncated = buffer.length > maxBytes
      remainingBytes -= Buffer.byteLength(returnedValue, 'utf8')
    } else if (includeValues && !protectedValue && valueBytes > 0) {
      valueTruncated = true
    }
    if (valueTruncated) truncated = true
    return {
      key,
      value: returnedValue,
      valueBytes,
      valueTruncated: valueTruncated || undefined,
      ...metadata
    }
  })
  return { items: bounded, truncated }
}
