import { describe, expect, it, vi } from 'vitest'
import {
  resolveWalletVaultProtection,
  type WalletSafeStorage
} from '../src/main/wallet/key-provider.js'

function safeStorage(overrides: Partial<WalletSafeStorage> = {}): WalletSafeStorage {
  return {
    isEncryptionAvailable: () => true,
    isAsyncEncryptionAvailable: async () => true,
    getSelectedStorageBackend: () => 'gnome_libsecret',
    encryptStringAsync: async () => Buffer.from('wrapped'),
    decryptStringAsync: async () => ({ result: 'decrypted', shouldReEncrypt: false }),
    ...overrides
  }
}

describe('wallet vault protection selection', () => {
  it.each(['gnome_libsecret', 'kwallet', 'kwallet5', 'kwallet6'] as const)(
    'uses secure Linux backend %s',
    async (backend) => {
      await expect(resolveWalletVaultProtection('linux', safeStorage({
        getSelectedStorageBackend: () => backend
      }))).resolves.toEqual({ mode: 'safe-storage', backend })
    }
  )

  it('never treats Linux basic_text as secure storage', async () => {
    await expect(resolveWalletVaultProtection('linux', safeStorage({
      getSelectedStorageBackend: () => 'basic_text'
    }))).resolves.toEqual({ mode: 'passphrase-required', backend: 'basic_text' })
  })

  it('requires a passphrase when Linux safeStorage is unavailable or unknown', async () => {
    await expect(resolveWalletVaultProtection('linux', safeStorage({
      isAsyncEncryptionAvailable: async () => false
    }))).resolves.toEqual({ mode: 'passphrase-required', backend: 'unavailable' })
    await expect(resolveWalletVaultProtection('linux', safeStorage({
      getSelectedStorageBackend: () => 'unknown'
    }))).resolves.toEqual({ mode: 'passphrase-required', backend: 'unknown' })
  })

  it('disables managed wallets rather than silently downgrading when backend detection fails', async () => {
    const warning = vi.fn()
    await expect(resolveWalletVaultProtection('linux', safeStorage({
      getSelectedStorageBackend: () => { throw new Error('backend failure') }
    }), warning)).resolves.toEqual({ mode: 'managed-wallets-disabled', backend: 'error' })
    expect(warning).toHaveBeenCalledWith('Wallet secure-storage detection failed')
  })

  it.each(['darwin', 'win32'] as const)('uses safeStorage on %s when available', async (platform) => {
    await expect(resolveWalletVaultProtection(platform, safeStorage())).resolves.toEqual({
      mode: 'safe-storage',
      backend: platform === 'darwin' ? 'keychain' : 'dpapi'
    })
  })
})
