import { describe, expect, it, vi } from 'vitest'
import { TronWeb, utils } from 'tronweb'
import { encodeAbiParameters, type Hex } from 'viem'
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

function trc20(selector: 'a9059cbb' | '095ea7b3', amount: bigint, options: {
  addressWordPrefix?: string
  suffix?: string
  callValue?: number | string
  callTokenValue?: number
} = {}): Record<string, unknown> {
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
            data: `${selector}${options.addressWordPrefix ?? destinationWord}${amountWord}${options.suffix ?? ''}`,
            ...(options.callValue === undefined ? {} : { call_value: options.callValue }),
            ...(options.callTokenValue === undefined ? {} : { call_token_value: options.callTokenValue, token_id: 1000001 })
          },
          type_url: 'type.googleapis.com/protocol.TriggerSmartContract'
        },
        type: 'TriggerSmartContract'
      }],
      ref_block_bytes: '0000', ref_block_hash: '0000000000000000', expiration: 2_000_000_000_000, timestamp: 1_999_999_000_000
    }
  })
}

function trc20TransferFrom(source: string, amount: bigint): Record<string, unknown> {
  const sourceWord = TronWeb.address.toHex(source).slice(2).padStart(64, '0')
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
            data: `23b872dd${sourceWord}${destinationWord}${amountWord}`
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
    transactionInfo: vi.fn(async () => ({ blockNumber: 77, receipt: { result: 'SUCCESS' } })),
    constantCall: vi.fn(async (_owner: string, _contract: string, selector: string): Promise<Hex> => (
      selector === 'balanceOf(address)' ? encodeAbiParameters([{ type: 'uint256' }], [12_345_678n])
        : selector === 'decimals()' ? encodeAbiParameters([{ type: 'uint8' }], [6])
          : encodeAbiParameters([{ type: 'string' }], ['USDT'])
    ))
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

  it('shows TRX sent along with a TRC-20 call and leaves calls that also send a TRC-10 token undecoded', async () => {
    const client = rpc()
    const adapter = new TronWalletAdapter(() => client)
    await expect(adapter.normalizeTransaction(wallet(), trc20('a9059cbb', 5n, { callValue: 2_500_000 }))).resolves.toMatchObject({
      decoded: { understood: true, method: 'trc20.transfer', nativeAmount: '2.5', tokenAmount: '5' }
    })
    const plain = await adapter.normalizeTransaction(wallet(), trc20('a9059cbb', 5n, { callValue: 0 }))
    expect(plain.decoded).not.toHaveProperty('nativeAmount')
    await expect(adapter.normalizeTransaction(wallet(), trc20('a9059cbb', 5n, { callTokenValue: 7 }))).resolves.toMatchObject({
      decoded: { understood: false, method: 'contract-call:a9059cbb' }
    })
    // TronWeb would sign this amount rounded to ...996.
    await expect(adapter.normalizeTransaction(wallet(), trc20('a9059cbb', 5n, { callValue: '9007199254740995' })))
      .rejects.toThrow('Tron contract call value is invalid')
  })

  it('simulates a TRC-20 call with the TRX it sends', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ result: { result: true }, energy_used: 10 })))
    vi.stubGlobal('fetch', fetchMock)
    try {
      const adapter = new TronWalletAdapter()
      const normalized = await adapter.normalizeTransaction(wallet(), trc20('a9059cbb', 5n, { callValue: 2_500_000 }))
      await expect(adapter.simulate(wallet(), normalized)).resolves.toMatchObject({ attempted: true, success: true })
      const body = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body)) as Record<string, unknown>
      expect(body.call_value).toBe(2_500_000)
      const tokenCall = await adapter.normalizeTransaction(wallet(), trc20('a9059cbb', 5n, { callTokenValue: 7 }))
      await adapter.simulate(wallet(), tokenCall)
      const tokenBody = JSON.parse(String((fetchMock.mock.calls[1] as unknown as [string, RequestInit])[1].body)) as Record<string, unknown>
      expect(tokenBody).toMatchObject({ call_token_value: 7, token_id: 1000001 })
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('names the TRC-20 contract and treats near-maximum approvals as unlimited', async () => {
    const adapter = new TronWalletAdapter(() => rpc())
    await expect(adapter.normalizeTransaction(wallet(), trc20('095ea7b3', 2n ** 200n))).resolves.toMatchObject({
      decoded: { method: 'trc20.approve', contract: destination, destination, unlimitedAllowance: true }
    })
    await expect(adapter.normalizeTransaction(wallet(), trc20('095ea7b3', 2n ** 160n - 2n))).resolves.toMatchObject({
      decoded: { method: 'trc20.approve', unlimitedAllowance: false }
    })
    await expect(adapter.normalizeTransaction(wallet(), trc20('095ea7b3', 2n ** 96n - 1n))).resolves.toMatchObject({
      decoded: { method: 'trc20.approve', unlimitedAllowance: true }
    })
    await expect(adapter.normalizeTransaction(wallet(), trc20('095ea7b3', 2n ** 128n - 1n))).resolves.toMatchObject({
      decoded: { method: 'trc20.approve', unlimitedAllowance: true }
    })
    await expect(adapter.normalizeTransaction(wallet(), trc20('095ea7b3', 2n ** 96n - 2n))).resolves.toMatchObject({
      decoded: { method: 'trc20.approve', unlimitedAllowance: false }
    })
    await expect(adapter.normalizeTransaction(wallet(), trc20('a9059cbb', 5n))).resolves.toMatchObject({
      decoded: { method: 'trc20.transfer', contract: destination }
    })
    await expect(adapter.normalizeTransaction(wallet(), trc20TransferFrom(owner, 5n))).resolves.toMatchObject({
      decoded: { method: 'trc20.transferFrom', contract: destination, source: owner }
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

  it('does not present non-canonical TRC20 calldata as an understood transfer', async () => {
    const adapter = new TronWalletAdapter(() => rpc())
    const destinationWord = TronWeb.address.toHex(destination).slice(2).padStart(64, '0')
    const dirtyAddressWord = `01${destinationWord.slice(2)}`
    const extraArgument = '0'.repeat(64)

    await expect(adapter.normalizeTransaction(wallet(), trc20('a9059cbb', 123n, {
      addressWordPrefix: dirtyAddressWord
    }))).resolves.toMatchObject({
      decoded: { understood: false, method: 'contract-call:a9059cbb', newContractOrProgram: true }
    })
    await expect(adapter.normalizeTransaction(wallet(), trc20('a9059cbb', 123n, {
      suffix: extraArgument
    }))).resolves.toMatchObject({
      decoded: { understood: false, method: 'contract-call:a9059cbb', newContractOrProgram: true }
    })
  })

  it('shows the token source and requires manual review for third-party transferFrom calls', async () => {
    const adapter = new TronWalletAdapter(() => rpc())

    await expect(adapter.normalizeTransaction(wallet(), trc20TransferFrom(owner, 123n))).resolves.toMatchObject({
      decoded: { understood: true, source: owner, destination, method: 'trc20.transferFrom', tokenAmount: '123' }
    })
    await expect(adapter.normalizeTransaction(wallet(), trc20TransferFrom(destination, 123n))).resolves.toMatchObject({
      decoded: { understood: false, source: destination, destination, method: 'trc20.transferFrom', tokenAmount: '123' }
    })
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

  it('reads TRC-20 token balances with decimals and a sanitized symbol', async () => {
    const client = rpc()
    const adapter = new TronWalletAdapter(() => client)
    const token = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'

    await expect(adapter.tokenBalance(wallet(), token)).resolves.toEqual({
      token, balance: '12.345678', rawBalance: '12345678', decimals: 6, symbol: 'USDT'
    })
    expect(client.constantCall).toHaveBeenCalledWith(owner, token, 'balanceOf(address)', [{ type: 'address', value: owner }])

    client.constantCall.mockImplementation(async (_owner: string, _contract: string, selector: string): Promise<Hex> => {
      if (selector === 'symbol()') throw new Error('no symbol')
      return selector === 'balanceOf(address)' ? encodeAbiParameters([{ type: 'uint256' }], [5n]) : encodeAbiParameters([{ type: 'uint8' }], [0])
    })
    await expect(adapter.tokenBalance(wallet(), token)).resolves.toEqual({ token, balance: '5', rawBalance: '5', decimals: 0 })
    await expect(adapter.tokenBalance(wallet(), '0x5FbDB2315678afecb367f032d93F642f64180aa3')).rejects.toThrow('TRC-20 contract address')
  })

  it('reads a TRC-20 allowance for a spender', async () => {
    const client = rpc()
    const adapter = new TronWalletAdapter(() => client)
    const token = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'
    const spender = 'TKzxdSv2FZKQrEqkKVgp5DcwEXBEKMg2Ax'
    client.constantCall.mockImplementation(async (_owner: string, _contract: string, selector: string): Promise<Hex> => (
      selector === 'allowance(address,address)' ? encodeAbiParameters([{ type: 'uint256' }], [(1n << 160n) - 1n])
        : selector === 'decimals()' ? encodeAbiParameters([{ type: 'uint8' }], [6])
          : selector === 'balanceOf(address)' ? encodeAbiParameters([{ type: 'uint256' }], [1n]) : encodeAbiParameters([{ type: 'string' }], ['USDT'])
    ))

    expect((await adapter.tokenBalance(wallet(), token, spender)).allowance).toEqual({
      spender, amount: '1461501637330902918203684832716283019655932.542975', rawAmount: ((1n << 160n) - 1n).toString(), unlimited: true
    })
    expect(client.constantCall).toHaveBeenCalledWith(owner, token, 'allowance(address,address)', [
      { type: 'address', value: owner }, { type: 'address', value: spender }
    ])
    await expect(adapter.tokenBalance(wallet(), token, '0x70997970C51812dc3A010C7d01b50e0d17dc79C8')).rejects.toThrow('spender must be an address')
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
