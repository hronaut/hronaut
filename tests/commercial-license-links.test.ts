import { describe, expect, it, vi } from 'vitest'
import {
  COMMERCIAL_LICENSE_API_BASE_URL,
  COMMERCIAL_LICENSE_PURCHASE_URL,
  commercialLicensePurchaseHandler
} from '../src/main/commercial-license-links.js'

describe('commercial license purchase links', () => {
  it('uses canonical production URLs without redirecting license POST requests', () => {
    expect(COMMERCIAL_LICENSE_PURCHASE_URL).toBe('https://hronaut.dev/#pricing')
    expect(COMMERCIAL_LICENSE_API_BASE_URL).toBe('https://hronaut.dev/api/creem-license')
  })

  it('checks the trusted sender and opens the fixed storefront in the system browser', async () => {
    const assertTrustedSender = vi.fn()
    const openExternal = vi.fn(async () => undefined)
    const handler = commercialLicensePurchaseHandler(assertTrustedSender, openExternal)
    const event = { sender: 'shell' }

    await handler(event)

    expect(assertTrustedSender).toHaveBeenCalledWith(event)
    expect(openExternal).toHaveBeenCalledWith(COMMERCIAL_LICENSE_PURCHASE_URL)
  })

  it('does not open anything for an untrusted sender', async () => {
    const openExternal = vi.fn(async () => undefined)
    const handler = commercialLicensePurchaseHandler(() => { throw new Error('Untrusted shell sender') }, openExternal)

    await expect(handler({})).rejects.toThrow('Untrusted shell sender')
    expect(openExternal).not.toHaveBeenCalled()
  })
})
