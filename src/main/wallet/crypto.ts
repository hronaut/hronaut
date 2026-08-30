import { randomBytes } from 'node:crypto'
import { Algorithm, Version, hashRaw } from '@node-rs/argon2'
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js'
import type { WalletChainFamily } from '../../shared/wallet.js'

const DATA_KEY_BYTES = 32
const NONCE_BYTES = 24
const TAG_BYTES = 16
const PASSPHRASE_SALT_BYTES = 16
const PASSPHRASE_DOMAIN = Buffer.from('hronaut-wallet-vault-wrap-v1', 'utf8')
const VAULT_KEY_AAD = Buffer.from('{"schemaVersion":1,"purpose":"hronaut-wallet-data-encryption-key"}', 'utf8')
const VAULT_AUTHORITY_AAD = Buffer.from('{"schemaVersion":1,"purpose":"hronaut-wallet-authority-state"}', 'utf8')

export interface WalletSecretMetadata {
  schemaVersion: number
  walletId: string
  chainFamily: WalletChainFamily
}

export interface EncryptedWalletSecret {
  algorithm: 'xchacha20-poly1305'
  nonce: string
  ciphertext: string
}

export interface WalletArgon2Parameters {
  memoryKiB: number
  passes: number
  parallelism: number
}

export const DEFAULT_WALLET_ARGON2_PARAMETERS: Readonly<WalletArgon2Parameters> = Object.freeze({
  memoryKiB: 64 * 1024,
  passes: 3,
  parallelism: 1
})

function walletAad(metadata: WalletSecretMetadata): Uint8Array {
  if (!Number.isInteger(metadata.schemaVersion) || metadata.schemaVersion <= 0) {
    throw new TypeError('Invalid wallet vault schema version')
  }
  if (!metadata.walletId || metadata.walletId.length > 128) throw new TypeError('Invalid wallet id')
  if (!['evm', 'solana', 'tron'].includes(metadata.chainFamily)) throw new TypeError('Invalid wallet chain family')
  return Buffer.from(JSON.stringify({
    schemaVersion: metadata.schemaVersion,
    walletId: metadata.walletId,
    chainFamily: metadata.chainFamily
  }), 'utf8')
}

function assertDataKey(key: Uint8Array): void {
  if (key.length !== DATA_KEY_BYTES) throw new TypeError('Wallet vault key must be 32 bytes')
}

function decodeBase64(value: string, expectedLength?: number): Buffer {
  if (!value || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) throw new Error('Wallet vault authentication failed')
  const bytes = Buffer.from(value, 'base64')
  if (bytes.toString('base64') !== value || (expectedLength !== undefined && bytes.length !== expectedLength)) {
    bytes.fill(0)
    throw new Error('Wallet vault authentication failed')
  }
  return bytes
}

function encryptAuthenticated(
  key: Uint8Array,
  aad: Uint8Array,
  plaintext: Uint8Array
): EncryptedWalletSecret {
  const nonce = randomBytes(NONCE_BYTES)
  try {
    const ciphertext = xchacha20poly1305(key, nonce, aad).encrypt(plaintext)
    return {
      algorithm: 'xchacha20-poly1305',
      nonce: nonce.toString('base64'),
      ciphertext: Buffer.from(ciphertext).toString('base64')
    }
  } finally {
    nonce.fill(0)
  }
}

function decryptAuthenticated(
  key: Uint8Array,
  aad: Uint8Array,
  encrypted: EncryptedWalletSecret
): Buffer {
  if (encrypted.algorithm !== 'xchacha20-poly1305') throw new Error('Wallet vault authentication failed')
  let nonce: Buffer | undefined
  let ciphertext: Buffer | undefined
  try {
    nonce = decodeBase64(encrypted.nonce, NONCE_BYTES)
    ciphertext = decodeBase64(encrypted.ciphertext)
    if (ciphertext.length <= TAG_BYTES) throw new Error('Wallet vault authentication failed')
    return Buffer.from(xchacha20poly1305(key, nonce, aad).decrypt(ciphertext))
  } catch {
    throw new Error('Wallet vault authentication failed')
  } finally {
    nonce?.fill(0)
    ciphertext?.fill(0)
  }
}

export function encryptWalletSecret(
  dataEncryptionKey: Uint8Array,
  metadata: WalletSecretMetadata,
  plaintext: Uint8Array
): EncryptedWalletSecret {
  assertDataKey(dataEncryptionKey)
  if (!plaintext.length) throw new TypeError('Wallet secret must not be empty')
  const aad = walletAad(metadata)
  try {
    return encryptAuthenticated(dataEncryptionKey, aad, plaintext)
  } finally {
    aad.fill(0)
  }
}

export function decryptWalletSecret(
  dataEncryptionKey: Uint8Array,
  metadata: WalletSecretMetadata,
  encrypted: EncryptedWalletSecret
): Buffer {
  assertDataKey(dataEncryptionKey)
  const aad = walletAad(metadata)
  try {
    return decryptAuthenticated(dataEncryptionKey, aad, encrypted)
  } finally {
    aad.fill(0)
  }
}

export function encryptWalletDataKey(wrappingKey: Uint8Array, dataEncryptionKey: Uint8Array): EncryptedWalletSecret {
  assertDataKey(wrappingKey)
  assertDataKey(dataEncryptionKey)
  return encryptAuthenticated(wrappingKey, VAULT_KEY_AAD, dataEncryptionKey)
}

export function decryptWalletDataKey(wrappingKey: Uint8Array, encrypted: EncryptedWalletSecret): Buffer {
  assertDataKey(wrappingKey)
  const dataEncryptionKey = decryptAuthenticated(wrappingKey, VAULT_KEY_AAD, encrypted)
  if (dataEncryptionKey.length !== DATA_KEY_BYTES) {
    dataEncryptionKey.fill(0)
    throw new Error('Wallet vault authentication failed')
  }
  return dataEncryptionKey
}

export function encryptWalletAuthorityState(
  dataEncryptionKey: Uint8Array,
  plaintext: Uint8Array,
  metadata: Uint8Array
): EncryptedWalletSecret {
  assertDataKey(dataEncryptionKey)
  if (!plaintext.length) throw new TypeError('Wallet authority state must not be empty')
  const aad = Buffer.concat([VAULT_AUTHORITY_AAD, Buffer.from([0]), metadata])
  try {
    return encryptAuthenticated(dataEncryptionKey, aad, plaintext)
  } finally {
    aad.fill(0)
  }
}

export function decryptWalletAuthorityState(
  dataEncryptionKey: Uint8Array,
  encrypted: EncryptedWalletSecret,
  metadata: Uint8Array
): Buffer {
  assertDataKey(dataEncryptionKey)
  const aad = Buffer.concat([VAULT_AUTHORITY_AAD, Buffer.from([0]), metadata])
  try {
    return decryptAuthenticated(dataEncryptionKey, aad, encrypted)
  } finally {
    aad.fill(0)
  }
}

export function rotateWalletSecret(
  currentDataEncryptionKey: Uint8Array,
  nextDataEncryptionKey: Uint8Array,
  metadata: WalletSecretMetadata,
  encrypted: EncryptedWalletSecret
): EncryptedWalletSecret {
  const plaintext = decryptWalletSecret(currentDataEncryptionKey, metadata, encrypted)
  try {
    return encryptWalletSecret(nextDataEncryptionKey, metadata, plaintext)
  } finally {
    plaintext.fill(0)
  }
}

function validateArgon2Parameters(parameters: WalletArgon2Parameters): void {
  if (!Number.isInteger(parameters.memoryKiB) || parameters.memoryKiB < 8 * 1024 || parameters.memoryKiB > 1024 * 1024) {
    throw new TypeError('Wallet Argon2 memory must be between 8192 and 1048576 KiB')
  }
  if (!Number.isInteger(parameters.passes) || parameters.passes < 1 || parameters.passes > 16) {
    throw new TypeError('Wallet Argon2 passes must be between 1 and 16')
  }
  if (!Number.isInteger(parameters.parallelism) || parameters.parallelism < 1 || parameters.parallelism > 16) {
    throw new TypeError('Wallet Argon2 parallelism must be between 1 and 16')
  }
}

export async function deriveWalletPassphraseKey(
  passphrase: Uint8Array,
  salt: Uint8Array,
  parameters: WalletArgon2Parameters = DEFAULT_WALLET_ARGON2_PARAMETERS
): Promise<Buffer> {
  if (!passphrase.length || passphrase.length > 16_384) throw new TypeError('Wallet vault passphrase is invalid')
  if (salt.length !== PASSPHRASE_SALT_BYTES) throw new TypeError('Wallet vault passphrase salt must be 16 bytes')
  validateArgon2Parameters(parameters)
  try {
    return await hashRaw(passphrase, {
      algorithm: Algorithm.Argon2id,
      version: Version.V0x13,
      memoryCost: parameters.memoryKiB,
      timeCost: parameters.passes,
      parallelism: parameters.parallelism,
      outputLen: DATA_KEY_BYTES,
      salt,
      secret: PASSPHRASE_DOMAIN
    })
  } catch {
    throw new Error('Wallet passphrase key derivation failed')
  }
}

export function generateWalletDataEncryptionKey(): Buffer {
  return randomBytes(DATA_KEY_BYTES)
}

export function generateWalletPassphraseSalt(): Buffer {
  return randomBytes(PASSPHRASE_SALT_BYTES)
}
