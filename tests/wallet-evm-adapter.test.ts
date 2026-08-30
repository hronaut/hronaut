import { describe, expect, it, vi } from 'vitest'
import {
  encodeFunctionData,
  maxUint256,
  parseAbi,
  parseTransaction,
  TransactionReceiptNotFoundError,
  type Hex
} from 'viem'
import { EvmWalletAdapter } from '../src/main/wallet/adapters/evm.js'
import type { WalletDescriptor } from '../src/shared/wallet.js'

const TOKEN_ABI = parseAbi([
  'function transfer(address to, uint256 amount) returns (bool)',
  'function approve(address spender, uint256 amount) returns (bool)'
])
const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'

function wallet(overrides: Partial<WalletDescriptor> = {}): WalletDescriptor {
  return {
    id: 'wallet-1', name: 'EVM', kind: 'imported', chainFamily: 'evm',
    publicAddress: '0x9858EfFD232B4033E47d90003D41EC34EcaEda94',
    network: { id: '31337', name: 'Anvil', environment: 'local', rpcUrl: 'http://127.0.0.1:8545' },
    capabilities: ['read', 'sign', 'send'], workspaceIds: ['workspace-1'], policyIds: [], recoveryConfirmed: true,
    createdAt: '2026-08-28T12:00:00.000Z', updatedAt: '2026-08-28T12:00:00.000Z', ...overrides
  }
}

function rpc() {
  return {
    getChainId: vi.fn(async () => 31337),
    prepareTransactionRequest: vi.fn(async (request: Record<string, unknown>) => ({
      nonce: 7,
      gas: 21_000n,
      gasPrice: 1_000_000_000n,
      type: 'legacy',
      ...request
    })),
    call: vi.fn(async () => ({ data: '0x' })),
    estimateGas: vi.fn(async () => 21_000n),
    getGasPrice: vi.fn(async () => 1_000_000_000n),
    getBalance: vi.fn(async () => 2_000_000_000_000_000_000n),
    sendRawTransaction: vi.fn(async () => `0x${'a'.repeat(64)}`),
    getTransactionReceipt: vi.fn(async () => ({ status: 'success', blockNumber: 123n })),
    waitForTransactionReceipt: vi.fn(async () => ({ status: 'success', blockNumber: 123n }))
  }
}

describe('EvmWalletAdapter', () => {
  it('normalizes and human-decodes native and known token operations', async () => {
    const client = rpc()
    const adapter = new EvmWalletAdapter(() => client as never)
    const native = await adapter.normalizeTransaction(wallet(), {
      from: wallet().publicAddress,
      to: '0x0000000000000000000000000000000000000002',
      value: '1000000000000000000',
      nonce: '0x1'
    })
    expect(native).toMatchObject({
      signer: wallet().publicAddress,
      nonceOrBlockhash: '1',
      decoded: { understood: true, method: 'native-transfer', nativeAmount: '1' }
    })

    const approve = await adapter.normalizeTransaction(wallet(), {
      to: '0x0000000000000000000000000000000000000010',
      data: encodeFunctionData({ abi: TOKEN_ABI, functionName: 'approve', args: ['0x0000000000000000000000000000000000000003', maxUint256] })
    })
    expect(approve.decoded).toMatchObject({
      understood: true,
      method: 'erc20.approve',
      destination: '0x0000000000000000000000000000000000000003',
      unlimitedAllowance: true
    })
  })

  it('fails closed for unknown calls, deployments, signer mismatch, and RPC chain mismatch', async () => {
    const client = rpc()
    const adapter = new EvmWalletAdapter(() => client as never)
    await expect(adapter.normalizeTransaction(wallet(), {
      from: '0x0000000000000000000000000000000000000004',
      to: '0x0000000000000000000000000000000000000002'
    })).rejects.toThrow('signer does not match')

    expect((await adapter.normalizeTransaction(wallet(), {
      to: '0x0000000000000000000000000000000000000002', data: '0x12345678'
    })).decoded).toMatchObject({ understood: false, newContractOrProgram: true })
    expect((await adapter.normalizeTransaction(wallet(), { data: '0x6000' })).decoded)
      .toMatchObject({ understood: false, method: 'contract-deployment', newContractOrProgram: true })

    client.getChainId.mockResolvedValueOnce(1)
    await expect(adapter.normalizeTransaction(wallet(), {
      to: '0x0000000000000000000000000000000000000002'
    })).rejects.toThrow('RPC chain does not match')
  })

  it('simulates, estimates fees, reads balances, and reports confirmation', async () => {
    const client = rpc()
    const adapter = new EvmWalletAdapter(() => client as never)
    const transaction = await adapter.normalizeTransaction(wallet(), {
      to: '0x0000000000000000000000000000000000000002', value: '1'
    })
    await expect(adapter.simulate(wallet(), transaction)).resolves.toMatchObject({
      attempted: true, success: true, estimatedFee: '0.000021'
    })
    await expect(adapter.balance(wallet())).resolves.toBe('2')
    await expect(adapter.confirmation(wallet(), `0x${'a'.repeat(64)}`)).resolves.toEqual({
      confirmed: true, failed: false, blockReference: '123'
    })
    expect(client.getTransactionReceipt).toHaveBeenCalledOnce()
    expect(client.waitForTransactionReceipt).not.toHaveBeenCalled()
  })

  it('reports a missing receipt as pending without opening a long-lived waiter', async () => {
    const client = rpc()
    const hash = `0x${'a'.repeat(64)}` as Hex
    client.getTransactionReceipt.mockRejectedValueOnce(new TransactionReceiptNotFoundError({ hash }))
    const adapter = new EvmWalletAdapter(() => client as never)

    await expect(adapter.confirmation(wallet(), hash)).resolves.toEqual({ confirmed: false, failed: false })
    expect(client.waitForTransactionReceipt).not.toHaveBeenCalled()
  })

  it('prepares omitted nonce, gas, and fee fields before approval and signing', async () => {
    const client = rpc()
    const adapter = new EvmWalletAdapter(() => client as never)
    const transaction = await adapter.normalizeTransaction(wallet(), {
      to: '0x0000000000000000000000000000000000000002', value: '1'
    })

    expect(client.prepareTransactionRequest).toHaveBeenCalledOnce()
    expect(transaction).toMatchObject({
      nonceOrBlockhash: '7',
      raw: { nonce: 7, gas: 21_000n, gasPrice: 1_000_000_000n, type: 'legacy' }
    })
  })

  it('rejects a nonce that cannot be represented exactly by the signer', async () => {
    const client = rpc()
    const adapter = new EvmWalletAdapter(() => client as never)

    await expect(adapter.normalizeTransaction(wallet(), {
      to: '0x0000000000000000000000000000000000000002',
      nonce: '0x20000000000001'
    })).rejects.toThrow('safe integer')
    expect(client.prepareTransactionRequest).not.toHaveBeenCalled()
  })

  it('rejects a configured chain ID that cannot be represented exactly by the signer', async () => {
    const client = rpc()
    client.getChainId.mockResolvedValueOnce(Number.MAX_SAFE_INTEGER + 1)
    const adapter = new EvmWalletAdapter(() => client as never)

    await expect(adapter.normalizeTransaction(wallet({
      network: { ...wallet().network, id: String(Number.MAX_SAFE_INTEGER + 1) }
    }), {
      to: '0x0000000000000000000000000000000000000002'
    })).rejects.toThrow('safe integer')
    expect(client.prepareTransactionRequest).not.toHaveBeenCalled()
  })

  it('rejects a negative configured chain ID', async () => {
    const client = rpc()
    client.getChainId.mockResolvedValueOnce(-1)
    const adapter = new EvmWalletAdapter(() => client as never)

    await expect(adapter.normalizeTransaction(wallet({
      network: { ...wallet().network, id: '-1' }
    }), {
      to: '0x0000000000000000000000000000000000000002'
    })).rejects.toThrow('non-negative')
    expect(client.prepareTransactionRequest).not.toHaveBeenCalled()
  })

  it('normalizes JSON-RPC transaction type quantities to viem transaction types', async () => {
    const client = rpc()
    const adapter = new EvmWalletAdapter(() => client as never)
    const transaction = await adapter.normalizeTransaction(wallet(), {
      to: '0x0000000000000000000000000000000000000002', type: '0x2'
    })

    expect(transaction.raw).toMatchObject({ type: 'eip1559' })
    await expect(adapter.normalizeTransaction(wallet(), {
      to: '0x0000000000000000000000000000000000000002', type: '0x7f'
    })).rejects.toThrow('transaction type is unsupported')
  })

  it('signs only with the selected account and clears caller-owned secret buffers', async () => {
    const adapter = new EvmWalletAdapter(() => rpc() as never)
    const transaction = await adapter.normalizeTransaction(wallet(), {
      to: '0x0000000000000000000000000000000000000002', value: '1', nonce: 0,
      gas: '21000', gasPrice: '1000000000', chainId: '31337'
    })
    const material = Buffer.from(mnemonic)
    const signed = await adapter.sign(wallet(), { format: 'mnemonic', material }, transaction)

    expect(parseTransaction(signed as Hex)).toMatchObject({ chainId: 31337, nonce: 0, to: '0x0000000000000000000000000000000000000002' })
    expect(material.every((value) => value === 0)).toBe(true)
    const wrong = Buffer.from(mnemonic)
    await expect(adapter.sign(wallet({ publicAddress: '0x0000000000000000000000000000000000000001' }), {
      format: 'mnemonic', material: wrong
    }, transaction)).rejects.toThrow('signer does not match')
    expect(wrong.every((value) => value === 0)).toBe(true)
  })
})
