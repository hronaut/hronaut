import { describe, expect, it, vi } from 'vitest'
import { TronWeb, utils } from 'tronweb'
import { TronWalletAdapter } from '../src/main/wallet/adapters/tron.js'
import type { WalletDescriptor } from '../src/shared/wallet.js'

const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
const owner = 'TUEZSdKsoDHQMeZwihtdoBiN46zxhGWYdH'
const destination = 'TAUN6FwrnwwmaEqYcckffC7wYmbaS6cBiX'

function wallet(overrides: Partial<WalletDescriptor> = {}): WalletDescriptor {
  return {
    id: 'wallet-1', name: 'Tron', kind: 'imported', chainFamily: 'tron', publicAddress: owner,
    network: { id: 'nile', name: 'Nile', environment: 'testnet', rpcUrl: 'http://127.0.0.1:9090' },
    capabilities: ['read', 'sign', 'send'], workspaceIds: ['workspace-1'], policyIds: [], recoveryConfirmed: true,
    createdAt: '2026-08-28T12:00:00.000Z', updatedAt: '2026-08-28T12:00:00.000Z', ...overrides
  }
}

function compile(transaction: Record<string, unknown>): Record<string, unknown> {
  const protobuf = utils.transaction.txJsonToPb(transaction)
  return {
    ...transaction,
    raw_data_hex: utils.transaction.txPbToRawDataHex(protobuf),
    txID: utils.transaction.txPbToTxID(protobuf).replace(/^0x/, '')
  }
}

function transfer(amount = 1_500_000): Record<string, unknown> {
  return compile({
    visible: false,
    raw_data: {
      contract: [{
        parameter: {
          value: {
            amount,
            owner_address: TronWeb.address.toHex(owner),
            to_address: TronWeb.address.toHex(destination)
          },
          type_url: 'type.googleapis.com/protocol.TransferContract'
        },
        type: 'TransferContract'
      }],
      ref_block_bytes: '0000', ref_block_hash: '0000000000000000', expiration: 2_000_000_000_000, timestamp: 1_999_999_000_000
    }
  })
}

function trc20(selector: 'a9059cbb' | '095ea7b3', amount: bigint): Record<string, unknown> {
  const destinationWord = TronWeb.address.toHex(destination).slice(2).padStart(64, '0')
  const amountWord = amount.toString(16).padStart(64, '0')
  return compile({
    visible: false,
    raw_data: {
      contract: [{
        parameter: {
          value: {
            owner_address: TronWeb.address.toHex(owner),
            contract_address: TronWeb.address.toHex(destination),
            data: `${selector}${destinationWord}${amountWord}`
          },
          type_url: 'type.googleapis.com/protocol.TriggerSmartContract'
        },
        type: 'TriggerSmartContract'
      }],
      ref_block_bytes: '0000', ref_block_hash: '0000000000000000', expiration: 2_000_000_000_000, timestamp: 1_999_999_000_000
    }
  })
}

function rpc() {
  return {
    simulate: vi.fn(async () => ({ attempted: true, success: true, estimatedFeeSun: 2_000_000n, logs: ['energy_used:1000'] })),
    balance: vi.fn(async () => 2_500_000n),
    broadcast: vi.fn(async (transaction: Record<string, unknown>) => ({ result: true, txid: transaction.txID as string })),
    transactionInfo: vi.fn(async () => ({ blockNumber: 77, receipt: { result: 'SUCCESS' } }))
  }
}

describe('TronWalletAdapter', () => {
  it('normalizes owner-bound transfers and known TRC20 calls', async () => {
    const adapter = new TronWalletAdapter(() => rpc())
    await expect(adapter.normalizeTransaction(wallet(), transfer())).resolves.toMatchObject({
      signer: owner,
      decoded: { understood: true, destination, method: 'trx.transfer', nativeAmount: '1.5' }
    })
    await expect(adapter.normalizeTransaction(wallet(), trc20('a9059cbb', 123n))).resolves.toMatchObject({
      decoded: { understood: true, destination, method: 'trc20.transfer', tokenAmount: '123' }
    })
    await expect(adapter.normalizeTransaction(wallet(), trc20('095ea7b3', (1n << 256n) - 1n))).resolves.toMatchObject({
      decoded: { understood: true, method: 'trc20.approve', unlimitedAllowance: true }
    })
  })

  it('rejects account mismatch, malformed addresses, and multi-contract requests', async () => {
    const adapter = new TronWalletAdapter(() => rpc())
    await expect(adapter.normalizeTransaction(wallet({ publicAddress: destination }), transfer()))
      .rejects.toThrow('signer does not match')
    const malformed = transfer() as { raw_data: { contract: Array<{ parameter: { value: Record<string, unknown> } }> } }
    malformed.raw_data.contract[0]!.parameter.value.to_address = 'not-an-address'
    await expect(adapter.normalizeTransaction(wallet(), malformed)).rejects.toThrow('address is invalid')
    const multiple = transfer() as { raw_data: { contract: unknown[] } }
    multiple.raw_data.contract.push(structuredClone(multiple.raw_data.contract[0]))
    await expect(adapter.normalizeTransaction(wallet(), multiple)).rejects.toThrow('Multi-contract')
  })

  it('rejects transaction JSON that does not match its signed Tron bytes and hash', async () => {
    const adapter = new TronWalletAdapter(() => rpc())
    const substitutedRawData = transfer() as {
      raw_data: { contract: Array<{ parameter: { value: Record<string, unknown> } }> }
    }
    substitutedRawData.raw_data.contract[0]!.parameter.value.amount = 9_000_000
    await expect(adapter.normalizeTransaction(wallet(), substitutedRawData))
      .rejects.toThrow('integrity check failed')

    const substitutedHash = transfer() as { txID: string }
    substitutedHash.txID = `${substitutedHash.txID.slice(0, -1)}${substitutedHash.txID.endsWith('0') ? '1' : '0'}`
    await expect(adapter.normalizeTransaction(wallet(), substitutedHash))
      .rejects.toThrow('integrity check failed')
  })

  it('rejects transaction mutation after normalization and still clears the secret', async () => {
    const adapter = new TronWalletAdapter(() => rpc())
    const normalized = await adapter.normalizeTransaction(wallet(), transfer())
    const raw = normalized.raw as {
      raw_data: { contract: Array<{ parameter: { value: Record<string, unknown> } }> }
    }
    raw.raw_data.contract[0]!.parameter.value.amount = 25_000_000
    const material = Buffer.from(mnemonic)

    await expect(adapter.sign(wallet(), { format: 'mnemonic', material }, normalized))
      .rejects.toThrow('integrity check failed')
    expect(material.every((value) => value === 0)).toBe(true)
  })

  it('simulates, signs, broadcasts, reads balances, and confirms without retaining the secret buffer', async () => {
    const client = rpc()
    const adapter = new TronWalletAdapter(() => client)
    const normalized = await adapter.normalizeTransaction(wallet(), transfer())
    await expect(adapter.simulate(wallet(), normalized)).resolves.toEqual({
      attempted: true, success: true, estimatedFee: '2', logs: ['energy_used:1000']
    })
    await expect(adapter.balance(wallet())).resolves.toBe('2.5')

    const material = Buffer.from(mnemonic)
    const signed = await adapter.sign(wallet(), { format: 'mnemonic', material }, normalized)
    expect(material.every((value) => value === 0)).toBe(true)
    expect(JSON.parse(Buffer.from(signed, 'base64').toString())).toHaveProperty('signature.0')
    await expect(adapter.broadcast(wallet(), signed)).resolves.toBe(normalized.raw.txID)
    await expect(adapter.confirmation(wallet(), normalized.raw.txID as string)).resolves.toEqual({
      confirmed: true, failed: false, blockReference: '77'
    })
  })
})
