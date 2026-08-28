import type { WalletArgon2Parameters, EncryptedWalletSecret } from './crypto.js'
import {
  decryptWalletDataKey,
  deriveWalletPassphraseKey,
  encryptWalletDataKey,
  generateWalletPassphraseSalt
} from './crypto.js'

export type WalletSafeStorageBackend =
  | 'basic_text'
  | 'gnome_libsecret'
  | 'kwallet'
  | 'kwallet5'
  | 'kwallet6'
  | 'unknown'

export interface WalletSafeStorage {
  isEncryptionAvailable(): boolean
  isAsyncEncryptionAvailable(): Promise<boolean>
  getSelectedStorageBackend(): WalletSafeStorageBackend
  encryptStringAsync(plainText: string): Promise<Buffer>
  decryptStringAsync(encrypted: Buffer): Promise<{ result: string; shouldReEncrypt: boolean }>
}

export type WalletVaultProtection =
  | { mode: 'safe-storage'; backend: 'keychain' | 'dpapi' | 'gnome_libsecret' | 'kwallet' | 'kwallet5' | 'kwallet6' }
  | { mode: 'passphrase-required'; backend: 'basic_text' | 'unknown' | 'unavailable' }
  | { mode: 'managed-wallets-disabled'; backend: 'error' | 'unavailable' }

export type PersistedWalletKeyProtection =
  | {
      mode: 'safe-storage'
      wrappedKey: string
    }
  | {
      mode: 'passphrase'
      salt: string
      parameters: WalletArgon2Parameters
      wrappedKey: EncryptedWalletSecret
    }

export interface UnwrappedWalletDataKey {
  key: Buffer
  replacement?: PersistedWalletKeyProtection
}

export interface WalletKeyWrapper {
  readonly mode: PersistedWalletKeyProtection['mode']
  wrap(dataEncryptionKey: Uint8Array, passphrase?: Uint8Array): Promise<PersistedWalletKeyProtection>
  unwrap(protection: PersistedWalletKeyProtection, passphrase?: Uint8Array): Promise<UnwrappedWalletDataKey>
}

function decodeCanonicalBase64(value: string, expectedLength?: number): Buffer {
  if (!value || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) throw new Error('Wallet vault unlock failed')
  const decoded = Buffer.from(value, 'base64')
  if (decoded.toString('base64') !== value || (expectedLength !== undefined && decoded.length !== expectedLength)) {
    decoded.fill(0)
    throw new Error('Wallet vault unlock failed')
  }
  return decoded
}

export class SafeStorageWalletKeyWrapper implements WalletKeyWrapper {
  readonly mode = 'safe-storage' as const

  constructor(private readonly safeStorage: WalletSafeStorage) {}

  async wrap(dataEncryptionKey: Uint8Array): Promise<PersistedWalletKeyProtection> {
    if (dataEncryptionKey.length !== 32) throw new TypeError('Wallet vault key must be 32 bytes')
    const encoded = Buffer.from(dataEncryptionKey).toString('base64')
    try {
      return {
        mode: this.mode,
        wrappedKey: (await this.safeStorage.encryptStringAsync(encoded)).toString('base64')
      }
    } catch {
      throw new Error('Wallet vault key wrapping failed')
    }
  }

  async unwrap(protection: PersistedWalletKeyProtection): Promise<UnwrappedWalletDataKey> {
    if (protection.mode !== this.mode) throw new Error('Wallet vault protection mode mismatch')
    let wrapped: Buffer | undefined
    try {
      wrapped = decodeCanonicalBase64(protection.wrappedKey)
      const decrypted = await this.safeStorage.decryptStringAsync(wrapped)
      const key = decodeCanonicalBase64(decrypted.result, 32)
      return {
        key,
        replacement: decrypted.shouldReEncrypt ? await this.wrap(key) : undefined
      }
    } catch {
      throw new Error('Wallet vault unlock failed')
    } finally {
      wrapped?.fill(0)
    }
  }
}

export class PassphraseWalletKeyWrapper implements WalletKeyWrapper {
  readonly mode = 'passphrase' as const

  constructor(private readonly parameters: WalletArgon2Parameters) {}

  async wrap(dataEncryptionKey: Uint8Array, passphrase?: Uint8Array): Promise<PersistedWalletKeyProtection> {
    if (!passphrase?.length) throw new Error('Wallet vault passphrase is required')
    const salt = generateWalletPassphraseSalt()
    const wrappingKey = await deriveWalletPassphraseKey(passphrase, salt, this.parameters)
    try {
      return {
        mode: this.mode,
        salt: salt.toString('base64'),
        parameters: { ...this.parameters },
        wrappedKey: encryptWalletDataKey(wrappingKey, dataEncryptionKey)
      }
    } finally {
      salt.fill(0)
      wrappingKey.fill(0)
    }
  }

  async unwrap(protection: PersistedWalletKeyProtection, passphrase?: Uint8Array): Promise<UnwrappedWalletDataKey> {
    if (protection.mode !== this.mode) throw new Error('Wallet vault protection mode mismatch')
    if (!passphrase?.length) throw new Error('Wallet vault passphrase is required')
    let salt: Buffer | undefined
    let wrappingKey: Buffer | undefined
    try {
      salt = decodeCanonicalBase64(protection.salt, 16)
      wrappingKey = await deriveWalletPassphraseKey(passphrase, salt, protection.parameters)
      return { key: decryptWalletDataKey(wrappingKey, protection.wrappedKey) }
    } catch {
      throw new Error('Wallet vault unlock failed')
    } finally {
      salt?.fill(0)
      wrappingKey?.fill(0)
    }
  }
}

const SECURE_LINUX_BACKENDS = new Set<WalletSafeStorageBackend>([
  'gnome_libsecret',
  'kwallet',
  'kwallet5',
  'kwallet6'
])

export async function resolveWalletVaultProtection(
  platform: NodeJS.Platform,
  safeStorage: WalletSafeStorage,
  warn: (message: string) => void = () => undefined
): Promise<WalletVaultProtection> {
  try {
    if (!await safeStorage.isAsyncEncryptionAvailable()) {
      return platform === 'linux'
        ? { mode: 'passphrase-required', backend: 'unavailable' }
        : { mode: 'managed-wallets-disabled', backend: 'unavailable' }
    }
    if (platform === 'darwin') return { mode: 'safe-storage', backend: 'keychain' }
    if (platform === 'win32') return { mode: 'safe-storage', backend: 'dpapi' }
    if (platform !== 'linux') return { mode: 'managed-wallets-disabled', backend: 'unavailable' }

    const backend = safeStorage.getSelectedStorageBackend()
    if (SECURE_LINUX_BACKENDS.has(backend)) {
      return { mode: 'safe-storage', backend: backend as 'gnome_libsecret' | 'kwallet' | 'kwallet5' | 'kwallet6' }
    }
    if (backend === 'basic_text' || backend === 'unknown') {
      return { mode: 'passphrase-required', backend }
    }
    return { mode: 'passphrase-required', backend: 'unknown' }
  } catch {
    warn('Wallet secure-storage detection failed')
    return { mode: 'managed-wallets-disabled', backend: 'error' }
  }
}
