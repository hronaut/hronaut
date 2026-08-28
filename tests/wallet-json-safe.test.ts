import { describe, expect, it } from 'vitest'
import { restoreWalletJson, walletJsonSafe } from '../src/main/wallet/json-safe.js'

describe('wallet JSON serialization', () => {
  it('round-trips reserved tag names as ordinary untrusted data', () => {
    const input = {
      nested: {
        __hronautWalletType: 'bytes',
        value: 'c2VjcmV0'
      }
    }

    const restored = restoreWalletJson(walletJsonSafe(input)) as typeof input
    expect(restored.nested).toEqual(input.nested)
    expect(restored.nested).not.toBeInstanceOf(Uint8Array)
  })

  it('preserves own __proto__ keys without changing object prototypes', () => {
    const input = JSON.parse('{"__proto__":{"polluted":true},"safe":1}') as Record<string, unknown>
    const restored = restoreWalletJson(walletJsonSafe(input)) as Record<string, unknown>

    expect(Object.hasOwn(restored, '__proto__')).toBe(true)
    expect(restored.__proto__).toEqual({ polluted: true })
    expect(Object.getPrototypeOf(restored)).toBeNull()
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined()
  })
})
