import { describe, expect, it } from 'vitest'
import { recoverMessageAddress } from 'viem'
import { TronWeb } from 'tronweb'
import {
  deriveWalletAccount,
  generateWalletRecovery,
  signWalletMessage,
  validateWatchOnlyWalletAddress
} from '../src/main/wallet/accounts.js'
import type { WalletChainFamily } from '../src/shared/wallet.js'

const mnemonic = Buffer.from('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about')

describe('wallet chain accounts', () => {
  it.each(['evm', 'solana', 'tron'] as const)('generates a chain-specific %s recovery phrase and valid address', async (chainFamily) => {
    const generated = await generateWalletRecovery(chainFamily)
    try {
      expect(generated.secret.format).toBe('mnemonic')
      expect(generated.secret.material.toString('utf8').trim().split(/\s+/)).toHaveLength(12)
      expect(validateWatchOnlyWalletAddress(chainFamily, generated.publicAddress)).toBe(true)
      const derived = await deriveWalletAccount(chainFamily, generated.secret)
      expect(derived.publicAddress).toBe(generated.publicAddress)
    } finally {
      generated.secret.material.fill(0)
    }
  })

  it('uses separate standard derivation paths for EVM, Solana, and Tron', async () => {
    const accounts = await Promise.all((['evm', 'solana', 'tron'] as const).map(async (chainFamily) => {
      const account = await deriveWalletAccount(chainFamily, { format: 'mnemonic', material: mnemonic })
      return [chainFamily, account.publicAddress] as const
    }))

    expect(Object.fromEntries(accounts)).toEqual({
      evm: '0x9858EfFD232B4033E47d90003D41EC34EcaEda94',
      solana: 'HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk',
      tron: 'TUEZSdKsoDHQMeZwihtdoBiN46zxhGWYdH'
    })
  })

  it.each([
    ['evm', '0x0000000000000000000000000000000000000001', true],
    ['evm', '0x1234', false],
    ['solana', 'HAgk14JpMQLgt6rVgv1BHPVxCV7zjTVBqBo5uR4J4qfJ', true],
    ['solana', 'not-solana', false],
    ['tron', 'TUEZSdKsoDHQMeZwihtdoBiN46zxhGWYdH', true],
    ['tron', '0x0000000000000000000000000000000000000001', false]
  ] as const)('validates %s watch-only address %s', (chainFamily, address, expected) => {
    expect(validateWatchOnlyWalletAddress(chainFamily, address)).toBe(expected)
  })

  it('imports raw private keys and derives the same public accounts', async () => {
    for (const chainFamily of ['evm', 'solana', 'tron'] as const) {
      const fromMnemonic = await deriveWalletAccount(chainFamily, { format: 'mnemonic', material: mnemonic })
      const fromPrivateKey = await deriveWalletAccount(chainFamily, {
        format: 'private-key',
        material: fromMnemonic.privateKey
      })
      expect(fromPrivateKey.publicAddress).toBe(fromMnemonic.publicAddress)
      fromMnemonic.privateKey.fill(0)
      fromPrivateKey.privateKey.fill(0)
    }
  })

  it.each(['evm', 'solana', 'tron'] as const)('sanitizes invalid %s secret errors', async (chainFamily) => {
    const marker = 'do-not-echo-secret'
    await expect(deriveWalletAccount(chainFamily, {
      format: 'private-key',
      material: Buffer.from(marker)
    })).rejects.toThrow('Invalid wallet recovery material')
    await deriveWalletAccount(chainFamily, {
      format: 'private-key',
      material: Buffer.from(marker)
    }).catch((error: Error) => expect(error.message).not.toContain(marker))
  })

  it('signs EVM messages with the expected account', async () => {
    const account = await deriveWalletAccount('evm', { format: 'mnemonic', material: mnemonic })
    try {
      const signature = await signWalletMessage('evm', account.privateKey, Buffer.from('hello wallet'))
      await expect(recoverMessageAddress({ message: { raw: '0x68656c6c6f2077616c6c6574' }, signature: signature as `0x${string}` }))
        .resolves.toBe(account.publicAddress)
    } finally {
      account.privateKey.fill(0)
    }
  })

  it('signs Solana messages with an Ed25519 signature', async () => {
    const account = await deriveWalletAccount('solana', { format: 'mnemonic', material: mnemonic })
    try {
      const signature = await signWalletMessage('solana', account.privateKey, Buffer.from('hello wallet'))
      expect(Buffer.from(signature, 'base64')).toHaveLength(64)
    } finally {
      account.privateKey.fill(0)
    }
  })

  it('signs Tron messages recoverable to the expected account', async () => {
    const account = await deriveWalletAccount('tron', { format: 'mnemonic', material: mnemonic })
    try {
      const message = Buffer.from('hello wallet')
      const signature = await signWalletMessage('tron', account.privateKey, message)
      const tron = new TronWeb({ fullHost: 'http://127.0.0.1:9090' })
      await expect(tron.trx.verifyMessageV2(message, signature)).resolves.toBe(account.publicAddress)
    } finally {
      account.privateKey.fill(0)
    }
  })

  it('refuses to sign when the trusted expected account does not match the private key', async () => {
    const account = await deriveWalletAccount('evm', { format: 'mnemonic', material: mnemonic })
    try {
      await expect(signWalletMessage(
        'evm', account.privateKey, Buffer.from('hello'), '0x0000000000000000000000000000000000000001'
      )).rejects.toThrow('Wallet signing account mismatch')
    } finally {
      account.privateKey.fill(0)
    }
  })

  it('does not accept an address for a different chain family', () => {
    const addresses: Record<WalletChainFamily, string> = {
      evm: '0x0000000000000000000000000000000000000001',
      solana: 'HAgk14JpMQLgt6rVgv1BHPVxCV7zjTVBqBo5uR4J4qfJ',
      tron: 'TUEZSdKsoDHQMeZwihtdoBiN46zxhGWYdH'
    }
    expect(validateWatchOnlyWalletAddress('evm', addresses.tron)).toBe(false)
    expect(validateWatchOnlyWalletAddress('solana', addresses.evm)).toBe(false)
    expect(validateWatchOnlyWalletAddress('tron', addresses.solana)).toBe(false)
  })
})
