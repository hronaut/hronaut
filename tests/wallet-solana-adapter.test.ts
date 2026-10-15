import { describe, expect, it, vi } from 'vitest'
import {
  AccountRole,
  address,
  appendTransactionMessageInstruction,
  blockhash,
  compileTransaction,
  createTransactionMessage,
  getBase64EncodedWireTransaction,
  getTransactionDecoder,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash
} from '@solana/kit'
import { SolanaWalletAdapter } from '../src/main/wallet/adapters/solana.js'
import type { WalletDescriptor } from '../src/shared/wallet.js'

const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
const signerAddress = 'HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk'
const destinationAddress = 'HAgk14JpMQLgt6rVgv1BHPVxCV7zjTVBqBo5uR4J4qfJ'
const systemProgramAddress = '11111111111111111111111111111111'

function wallet(overrides: Partial<WalletDescriptor> = {}): WalletDescriptor {
  return {
    id: 'wallet-1', name: 'Solana', kind: 'imported', chainFamily: 'solana', publicAddress: signerAddress,
    network: { id: 'localnet', name: 'Local validator', environment: 'local', rpcUrl: 'http://127.0.0.1:8899' },
    capabilities: ['read', 'sign', 'send'], workspaceIds: ['workspace-1'], policyIds: [], recoveryConfirmed: true,
    createdAt: '2026-08-28T12:00:00.000Z', updatedAt: '2026-08-28T12:00:00.000Z', ...overrides
  }
}

function transferTransaction(lamports = 1_500_000_000n, version: 'legacy' | 0 = 'legacy'): string {
  const data = new Uint8Array(12)
  data[0] = 2
  let amount = lamports
  for (let index = 4; index < 12; index += 1) {
    data[index] = Number(amount & 0xffn)
    amount >>= 8n
  }
  const message = appendTransactionMessageInstruction({
    programAddress: address(systemProgramAddress),
    accounts: [
      { address: address(signerAddress), role: AccountRole.WRITABLE_SIGNER },
      { address: address(destinationAddress), role: AccountRole.WRITABLE }
    ],
    data
  }, setTransactionMessageLifetimeUsingBlockhash({
    blockhash: blockhash(systemProgramAddress), lastValidBlockHeight: 100n
  }, setTransactionMessageFeePayer(address(signerAddress), createTransactionMessage({ version }))))
  return getBase64EncodedWireTransaction(compileTransaction(message))
}

function rpc() {
  return {
    simulate: vi.fn(async () => ({ err: null, fee: 5_000n, logs: ['Program log: ok'] })),
    balance: vi.fn(async () => 2_500_000_000n),
    tokenBalance: vi.fn(async () => ({ amount: 12_345_000n, decimals: 6 })),
    send: vi.fn(async () => '5'.repeat(88)),
    status: vi.fn(async () => ({ confirmationStatus: 'confirmed', err: null, slot: 99n }))
  }
}

describe('SolanaWalletAdapter', () => {
  it('normalizes legacy transactions, validates the required signer, and decodes system transfers', async () => {
    const adapter = new SolanaWalletAdapter(() => rpc())
    const normalized = await adapter.normalizeTransaction(wallet(), {
      transaction: transferTransaction(), account: { address: signerAddress }, chain: 'solana:localnet'
    })

    expect(normalized).toMatchObject({
      signer: signerAddress,
      decoded: {
        understood: true,
        method: 'system.transfer',
        destination: destinationAddress,
        nativeAmount: '1.5'
      }
    })
    await expect(adapter.normalizeTransaction(wallet(), {
      transaction: transferTransaction(), account: destinationAddress
    })).rejects.toThrow('signer does not match')
    await expect(adapter.normalizeTransaction(wallet(), {
      transaction: transferTransaction(), chain: 'solana:mainnet'
    })).rejects.toThrow('chain does not match')
  })

  it('rejects malformed payloads and transactions that do not require the selected signer', async () => {
    const adapter = new SolanaWalletAdapter(() => rpc())
    await expect(adapter.normalizeTransaction(wallet(), { transaction: 'not-base64' }))
      .rejects.toThrow('encoding is invalid')
    await expect(adapter.normalizeTransaction(wallet({ publicAddress: destinationAddress }), {
      transaction: transferTransaction()
    })).rejects.toThrow('does not require the selected signer')
  })

  it('simulates, estimates fees, reads balances, signs, broadcasts, and confirms', async () => {
    const client = rpc()
    const adapter = new SolanaWalletAdapter(() => client)
    const normalized = await adapter.normalizeTransaction(wallet(), { transaction: transferTransaction() })
    await expect(adapter.simulate(wallet(), normalized)).resolves.toEqual({
      attempted: true, success: true, estimatedFee: '0.000005', logs: ['Program log: ok']
    })
    await expect(adapter.balance(wallet())).resolves.toBe('2.5')
    const mint = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
    await expect(adapter.tokenBalance(wallet(), mint)).resolves.toEqual({
      token: mint, balance: '12.345', rawBalance: '12345000', decimals: 6
    })
    expect(client.tokenBalance).toHaveBeenCalledWith(wallet().publicAddress, mint)
    await expect(adapter.tokenBalance(wallet(), '0x9858EfFD232B4033E47d90003D41EC34EcaEda94'))
      .rejects.toThrow('SPL token mint address')

    const material = Buffer.from(mnemonic)
    const signed = await adapter.sign(wallet(), { format: 'mnemonic', material }, normalized)
    const decoded = getTransactionDecoder().decode(Buffer.from(signed, 'base64'))
    expect(decoded.signatures[address(signerAddress)]).not.toBeNull()
    expect(material.every((value) => value === 0)).toBe(true)
    await expect(adapter.broadcast(wallet(), signed)).resolves.toBe('5'.repeat(88))
    await expect(adapter.confirmation(wallet(), '5'.repeat(88))).resolves.toEqual({
      confirmed: true, failed: false, blockReference: '99'
    })
  })

  it('normalizes, decodes, signs and verifies version 0 transactions like legacy ones', async () => {
    const adapter = new SolanaWalletAdapter(() => rpc())
    const transaction = transferTransaction(1_500_000_000n, 0)
    expect(Buffer.from(transaction, 'base64').subarray(65)[0]).toBe(0x80)
    const normalized = await adapter.normalizeTransaction(wallet(), {
      transaction, account: { address: signerAddress }, chain: 'solana:localnet'
    })
    expect(normalized.decoded).toMatchObject({ understood: true, method: 'system.transfer', nativeAmount: '1.5' })

    const signed = await adapter.sign(wallet(), { format: 'mnemonic', material: Buffer.from(mnemonic) }, normalized)
    const decoded = getTransactionDecoder().decode(Buffer.from(signed, 'base64'))
    expect(decoded.messageBytes[0]).toBe(0x80)
    expect(decoded.signatures[address(signerAddress)]).not.toBeNull()
  })
})
