import { randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  decryptWalletSecret,
  deriveWalletPassphraseKey,
  encryptWalletSecret,
  rotateWalletSecret,
  type WalletSecretMetadata
} from '../src/main/wallet/crypto.js'

const metadata: WalletSecretMetadata = {
  schemaVersion: 1,
  walletId: 'wallet-018f',
  chainFamily: 'evm'
}

describe('wallet envelope cryptography', () => {
  it('round-trips a wallet secret without serializing plaintext', () => {
    const key = randomBytes(32)
    const secret = Buffer.from('test-only private key material', 'utf8')

    const encrypted = encryptWalletSecret(key, metadata, secret)

    expect(JSON.stringify(encrypted)).not.toContain(secret.toString('utf8'))
    expect(decryptWalletSecret(key, metadata, encrypted)).toEqual(secret)
    key.fill(0)
    secret.fill(0)
  })

  it.each(['ciphertext', 'nonce'] as const)('rejects modified %s', (field) => {
    const key = randomBytes(32)
    const encrypted = encryptWalletSecret(key, metadata, Buffer.from('secret'))
    const bytes = Buffer.from(encrypted[field], 'base64')
    const index = Math.floor(bytes.length / 2)
    bytes[index] = bytes[index]! ^ 0xff

    expect(() => decryptWalletSecret(key, metadata, { ...encrypted, [field]: bytes.toString('base64') }))
      .toThrow('Wallet vault authentication failed')
  })

  it('rejects truncated ciphertext', () => {
    const key = randomBytes(32)
    const encrypted = encryptWalletSecret(key, metadata, Buffer.from('secret'))
    const bytes = Buffer.from(encrypted.ciphertext, 'base64')

    expect(() => decryptWalletSecret(key, metadata, {
      ...encrypted,
      ciphertext: bytes.subarray(0, bytes.length - 1).toString('base64')
    })).toThrow('Wallet vault authentication failed')
  })

  it('binds ciphertext to wallet id, schema version, and chain family', () => {
    const key = randomBytes(32)
    const encrypted = encryptWalletSecret(key, metadata, Buffer.from('secret'))

    expect(() => decryptWalletSecret(key, { ...metadata, walletId: 'substituted' }, encrypted))
      .toThrow('Wallet vault authentication failed')
    expect(() => decryptWalletSecret(key, { ...metadata, schemaVersion: 2 }, encrypted))
      .toThrow('Wallet vault authentication failed')
    expect(() => decryptWalletSecret(key, { ...metadata, chainFamily: 'solana' }, encrypted))
      .toThrow('Wallet vault authentication failed')
  })

  it('rotates an encrypted record to a new data-encryption key', () => {
    const oldKey = randomBytes(32)
    const newKey = randomBytes(32)
    const encrypted = encryptWalletSecret(oldKey, metadata, Buffer.from('secret'))

    const rotated = rotateWalletSecret(oldKey, newKey, metadata, encrypted)

    expect(decryptWalletSecret(newKey, metadata, rotated).toString('utf8')).toBe('secret')
    expect(() => decryptWalletSecret(oldKey, metadata, rotated)).toThrow('Wallet vault authentication failed')
  })

  it('derives deterministic, domain-separated Argon2id wrapping keys', async () => {
    const salt = Buffer.alloc(16, 0x5a)
    const first = await deriveWalletPassphraseKey(Buffer.from('correct horse battery staple'), salt, {
      memoryKiB: 8 * 1024,
      passes: 2,
      parallelism: 1
    })
    const second = await deriveWalletPassphraseKey(Buffer.from('correct horse battery staple'), salt, {
      memoryKiB: 8 * 1024,
      passes: 2,
      parallelism: 1
    })
    const otherSalt = await deriveWalletPassphraseKey(Buffer.from('correct horse battery staple'), Buffer.alloc(16, 0x5b), {
      memoryKiB: 8 * 1024,
      passes: 2,
      parallelism: 1
    })

    expect(first).toEqual(second)
    expect(first).not.toEqual(otherSalt)
    expect(first).toHaveLength(32)
    expect(first.toString('hex')).toBe('517a68beb7ff490d7023a2fa5385e5d14fd96aa5dec341560db13ae5c1898705')
    first.fill(0)
    second.fill(0)
    otherSalt.fill(0)
  })
})
