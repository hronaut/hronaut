import { describe, expect, it, vi } from 'vitest'
import { encryptsWithKeyringKey } from '../src/main/keyring-key.js'

/** Secure storage whose encryption starts with `prefix`, as Chromium marks which key encrypted a text. */
function storage(prefix: string) {
  return { encryptStringAsync: vi.fn(async (value: string) => Buffer.from(`${prefix}${value}`)) }
}

describe('whether secure storage encrypts with a keyring\'s key', () => {
  it('tells Linux\'s fallback key, used when no keyring answered, from a keyring\'s', async () => {
    await expect(encryptsWithKeyringKey(storage('v10'), 'linux')).resolves.toBe(false)
    await expect(encryptsWithKeyringKey(storage('v11'), 'linux')).resolves.toBe(true)
    // Through the desktop portal, as in a Flatpak.
    await expect(encryptsWithKeyringKey(storage('v12'), 'linux')).resolves.toBe(true)
  })

  it('encrypts a text that is not empty, which alone carries the key\'s mark', async () => {
    const fallback = storage('v10')
    await encryptsWithKeyringKey(fallback, 'linux')
    expect(fallback.encryptStringAsync).toHaveBeenCalledOnce()
    expect(fallback.encryptStringAsync.mock.calls[0]![0]).not.toBe('')
  })

  it.each(['darwin', 'win32'] as const)('trusts %s, which keeps the key in its own store, without encrypting', async (platform) => {
    const system = storage('v10')
    await expect(encryptsWithKeyringKey(system, platform)).resolves.toBe(true)
    expect(system.encryptStringAsync).not.toHaveBeenCalled()
  })
})
