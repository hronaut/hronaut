import { describe, expect, it, vi } from 'vitest'
import {
  encodeFunctionData,
  getAddress,
  maxUint256,
  parseAbi,
  parseTransaction,
  RpcRequestError,
  TransactionReceiptNotFoundError,
  type Hex
} from 'viem'
import { EvmWalletAdapter } from '../src/main/wallet/adapters/evm.js'
import type { WalletDescriptor } from '../src/shared/wallet.js'

const TOKEN_ABI = parseAbi([
  'function transfer(address to, uint256 amount) returns (bool)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function increaseAllowance(address spender, uint256 addedValue) returns (bool)',
  'function transferFrom(address from, address to, uint256 amount) returns (bool)',
  'function setApprovalForAll(address operator, bool approved)'
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
    readContract: vi.fn(async ({ functionName }: { functionName: string }): Promise<unknown> => (
      functionName === 'balanceOf' ? 1_500_000n : functionName === 'decimals' ? 6 : 'USDC'
    )),
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

  it('names the token contract and treats near-maximum and collection-wide approvals as unlimited', async () => {
    const adapter = new EvmWalletAdapter(() => rpc() as never)
    const token = '0x00000000000000000000000000000000000000aa'
    const spender = '0x0000000000000000000000000000000000000003'
    const decode = async (data: Hex) => (await adapter.normalizeTransaction(wallet(), { to: token, data })).decoded
    const approve = (amount: bigint) => encodeFunctionData({ abi: TOKEN_ABI, functionName: 'approve', args: [spender, amount] })

    expect(await decode(approve(2n ** 200n))).toMatchObject({
      understood: true, method: 'erc20.approve', contract: getAddress(token), destination: spender, unlimitedAllowance: true
    })
    expect(await decode(approve(2n ** 160n - 1n))).toMatchObject({ unlimitedAllowance: true })
    expect(await decode(approve(2n ** 160n - 2n))).toMatchObject({ method: 'erc20.approve', unlimitedAllowance: false })
    expect(await decode(encodeFunctionData({ abi: TOKEN_ABI, functionName: 'increaseAllowance', args: [spender, maxUint256] })))
      .toMatchObject({ understood: true, method: 'erc20.increaseAllowance', contract: getAddress(token), tokenAmount: maxUint256.toString(), unlimitedAllowance: true })
    expect(await decode(encodeFunctionData({ abi: TOKEN_ABI, functionName: 'transfer', args: [spender, 5n] })))
      .toMatchObject({ method: 'erc20.transfer', contract: getAddress(token), destination: spender, tokenAmount: '5' })

    const approveAll = await decode(encodeFunctionData({ abi: TOKEN_ABI, functionName: 'setApprovalForAll', args: [spender, true] }))
    expect(approveAll).toMatchObject({
      understood: true, method: 'nft.setApprovalForAll', contract: getAddress(token), destination: spender, unlimitedAllowance: true
    })
    expect(approveAll).not.toHaveProperty('tokenAmount')
    expect(await decode(encodeFunctionData({ abi: TOKEN_ABI, functionName: 'setApprovalForAll', args: [spender, false] })))
      .toMatchObject({ understood: true, method: 'nft.setApprovalForAll', unlimitedAllowance: false })
    // A boolean word other than 0 or 1 is not a valid call, so it stays unknown.
    const invalidBool = encodeFunctionData({ abi: TOKEN_ABI, functionName: 'setApprovalForAll', args: [spender, true] }).replace(/1$/, '2') as Hex
    expect(await decode(invalidBool)).toMatchObject({ understood: false, method: 'contract-call:0xa22cb465', newContractOrProgram: true })
  })

  it('shows the token source and requires manual review for third-party transferFrom calls', async () => {
    const adapter = new EvmWalletAdapter(() => rpc() as never)
    const signer = wallet().publicAddress as `0x${string}`
    const destination = '0x0000000000000000000000000000000000000003' as const
    const ownTransfer = await adapter.normalizeTransaction(wallet(), {
      to: '0x0000000000000000000000000000000000000010',
      data: encodeFunctionData({
        abi: TOKEN_ABI,
        functionName: 'transferFrom',
        args: [signer, destination, 123n]
      })
    })
    expect(ownTransfer.decoded).toMatchObject({
      understood: true,
      method: 'erc20.transferFrom',
      source: signer,
      destination,
      tokenAmount: '123'
    })

    const thirdPartyTransfer = await adapter.normalizeTransaction(wallet(), {
      to: '0x0000000000000000000000000000000000000010',
      data: encodeFunctionData({
        abi: TOKEN_ABI,
        functionName: 'transferFrom',
        args: ['0x0000000000000000000000000000000000000004', destination, 123n]
      })
    })
    expect(thirdPartyTransfer.decoded).toMatchObject({
      understood: false,
      method: 'erc20.transferFrom',
      source: '0x0000000000000000000000000000000000000004',
      destination
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

  it('reads ERC-20 token balances with decimals and a sanitized symbol', async () => {
    const client = rpc()
    const adapter = new EvmWalletAdapter(() => client as never)
    const token = '0x5fbdb2315678afecb367f032d93f642f64180aa3'

    await expect(adapter.tokenBalance(wallet(), token)).resolves.toEqual({
      token: '0x5FbDB2315678afecb367f032d93F642f64180aa3', balance: '1.5', rawBalance: '1500000', decimals: 6, symbol: 'USDC'
    })
    expect(client.readContract).toHaveBeenCalledWith(expect.objectContaining({
      functionName: 'balanceOf', args: [wallet().publicAddress]
    }))

    client.readContract.mockImplementation(async ({ functionName }: { functionName: string }) => {
      if (functionName === 'symbol') throw new Error('no symbol')
      return functionName === 'balanceOf' ? 7n : 0
    })
    await expect(adapter.tokenBalance(wallet(), token)).resolves.toEqual({
      token: '0x5FbDB2315678afecb367f032d93F642f64180aa3', balance: '7', rawBalance: '7', decimals: 0
    })
    client.readContract.mockImplementation(async ({ functionName }: { functionName: string }) => (
      functionName === 'balanceOf' ? 1n : functionName === 'decimals' ? 18 : '<script>'
    ))
    await expect(adapter.tokenBalance(wallet(), token)).resolves.not.toHaveProperty('symbol')
    await expect(adapter.tokenBalance(wallet(), 'not-an-address')).rejects.toThrow('ERC-20 contract address')
  })

  it('reads how much a spender may still move, and marks an unlimited approval', async () => {
    const client = rpc()
    const adapter = new EvmWalletAdapter(() => client as never)
    const token = '0x5fbdb2315678afecb367f032d93f642f64180aa3'
    const spender = '0x70997970c51812dc3a010c7d01b50e0d17dc79c8'
    let allowance = 2_500_000n
    client.readContract.mockImplementation(async ({ functionName }: { functionName: string }) => (
      functionName === 'allowance' ? allowance : functionName === 'balanceOf' ? 1_500_000n : functionName === 'decimals' ? 6 : 'USDC'
    ))

    await expect(adapter.tokenBalance(wallet(), token, spender)).resolves.toMatchObject({
      balance: '1.5', allowance: { spender: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8', amount: '2.5', rawAmount: '2500000' }
    })
    expect(client.readContract).toHaveBeenCalledWith(expect.objectContaining({
      functionName: 'allowance', args: [wallet().publicAddress, '0x70997970C51812dc3A010C7d01b50e0d17dc79C8']
    }))
    allowance = (1n << 256n) - 1n
    expect((await adapter.tokenBalance(wallet(), token, spender)).allowance).toMatchObject({ unlimited: true, rawAmount: allowance.toString() })
    // Permit2's unlimited amount is the threshold; one less is a large but limited approval.
    allowance = (1n << 160n) - 1n
    expect((await adapter.tokenBalance(wallet(), token, spender)).allowance).toMatchObject({ unlimited: true })
    allowance -= 1n
    expect((await adapter.tokenBalance(wallet(), token, spender)).allowance).not.toHaveProperty('unlimited')
    allowance = 0n
    expect((await adapter.tokenBalance(wallet(), token, spender)).allowance).toEqual({ spender: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8', amount: '0', rawAmount: '0' })
    // Without a spender, no allowance is read.
    client.readContract.mockClear()
    await expect(adapter.tokenBalance(wallet(), token)).resolves.not.toHaveProperty('allowance')
    expect(client.readContract).not.toHaveBeenCalledWith(expect.objectContaining({ functionName: 'allowance' }))
    await expect(adapter.tokenBalance(wallet(), token, 'not-an-address')).rejects.toThrow('spender must be an address')
  })

  it('reads a token contract\'s own symbol and decimals without the wallet account, leaving out what it does not report', async () => {
    const client = rpc()
    const adapter = new EvmWalletAdapter(() => client as never)
    const token = '0x5fbdb2315678afecb367f032d93f642f64180aa3'

    await expect(adapter.tokenContractDetails(wallet(), token)).resolves.toEqual({ symbol: 'USDC', decimals: 6 })
    expect(client.readContract).not.toHaveBeenCalledWith(expect.objectContaining({ functionName: 'balanceOf' }))
    client.readContract.mockImplementation(async ({ functionName }: { functionName: string }) => {
      if (functionName === 'decimals') throw new Error('no decimals')
      return 'USD\u20AE0'
    })
    await expect(adapter.tokenContractDetails(wallet(), token)).resolves.toEqual({ symbol: 'USD\u20AE0' })
    client.readContract.mockImplementation(async ({ functionName }: { functionName: string }) => (functionName === 'decimals' ? 18 : 'US\u202EDC'))
    await expect(adapter.tokenContractDetails(wallet(), token)).resolves.toEqual({ decimals: 18 })
    await expect(adapter.tokenContractDetails(wallet(), 'not-an-address')).rejects.toThrow('ERC-20 contract address')
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

  it('forwards only allowlisted read-only JSON-RPC methods and bounds their params', async () => {
    const client = { ...rpc(), request: vi.fn(async () => '0x1234') }
    const adapter = new EvmWalletAdapter(() => client as never)

    await expect(adapter.readRpc(wallet(), 'eth_call', [{ to: '0x0000000000000000000000000000000000000002', data: '0x' }, 'latest']))
      .resolves.toBe('0x1234')
    expect(client.request).toHaveBeenCalledWith({
      method: 'eth_call', params: [{ to: '0x0000000000000000000000000000000000000002', data: '0x' }, 'latest']
    })
    await expect(adapter.readRpc(wallet(), 'eth_blockNumber', undefined)).resolves.toBe('0x1234')
    expect(client.request).toHaveBeenLastCalledWith({ method: 'eth_blockNumber', params: [] })
    await expect(adapter.readRpc(wallet(), 'net_version', undefined)).resolves.toBe('31337')
    await expect(adapter.readRpc(wallet(), 'eth_newFilter', [{ fromBlock: 'latest' }])).resolves.toBe('0x1234')
    expect(client.request).toHaveBeenLastCalledWith({ method: 'eth_newFilter', params: [{ fromBlock: 'latest' }] })
    await expect(adapter.readRpc(wallet(), 'eth_sendRawTransaction', ['0x00'])).rejects.toThrow('Unsupported EVM wallet method')
    await expect(adapter.readRpc(wallet(), 'eth_getLogs', [{}, {}, {}, {}, {}])).rejects.toThrow('at most 4 values')
    await expect(adapter.readRpc(wallet(), 'eth_getLogs', { fromBlock: '0x0' })).rejects.toThrow('must be an array')
    expect(client.request).toHaveBeenCalledTimes(3)
  })

  it('returns node errors with code and revert data but never the RPC endpoint', async () => {
    const revert = new RpcRequestError({
      body: { method: 'eth_call' },
      error: { code: 3, message: 'execution reverted: Not owner', data: '0x08c379a0' },
      url: 'https://secret-key.rpc.example/v3/abc'
    })
    const client = { ...rpc(), request: vi.fn(async () => { throw revert }) }
    const adapter = new EvmWalletAdapter(() => client as never)
    const error = await adapter.readRpc(wallet(), 'eth_call', [{}]).then(() => new Error('resolved'), (cause: unknown) => cause as Error)
    expect(error.message).toBe('EVM RPC error (code 3, data 0x08c379a0): execution reverted: Not owner')
    expect(error.message).not.toContain('secret-key')

    client.request.mockRejectedValueOnce(new Error('fetch failed for https://secret-key.rpc.example/v3/abc'))
    await expect(adapter.readRpc(wallet(), 'eth_blockNumber', [])).rejects.toThrow(/^EVM RPC read request failed$/)
  })
})
