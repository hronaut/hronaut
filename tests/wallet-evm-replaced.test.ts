import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { EvmWalletAdapter } from '../src/main/wallet/adapters/evm.js'
import type { WalletDescriptor } from '../src/shared/wallet.js'

const HASH = `0x${'ab'.repeat(32)}`
const OTHER_HASH = `0x${'cd'.repeat(32)}`
const ADDRESS = '0x9858EfFD232B4033E47d90003D41EC34EcaEda94'
const SOMEONE_ELSE = '0x0000000000000000000000000000000000000007'

let server: Server | undefined

afterEach(async () => {
  await new Promise<void>((resolve) => server ? server.close(() => resolve()) : resolve())
  server = undefined
})

interface NodeState {
  receipt?: Record<string, unknown>
  /** Whether the node still holds the transaction. */
  holds?: boolean
  /** The latest block; 100 unless set. */
  latest?: number
  /** The block in which the account used nonce 9, from which on its mined count is 10; unset, nonce 9 is unused. */
  usedIn?: number
  /** The hash of the account's transaction there; another transaction's unless set. */
  taker?: string
  /** The hash of every block, which changes when the chain replaces them. */
  blockHash?: string
  /** The mined count the node gives for the latest block by name, such as from a backend ahead of the one giving block numbers. */
  latestCount?: string
  /** An error code eth_getTransactionCount answers with. */
  countError?: number
  /** The oldest block the node keeps account state for. */
  oldestState?: number
  /** Whether the block in which the account used the nonce shows no transaction of the account, or no block at all. */
  block?: 'empty' | 'missing'
  /** An error code eth_getTransactionByHash answers with. */
  lookupError?: number
}

const hex = (value: number) => `0x${value.toString(16)}`

function transaction(hash: string, from: string, blockNumber: number | null) {
  return {
    hash, nonce: '0x9', blockHash: blockNumber === null ? null : `0x${'e'.repeat(64)}`, blockNumber: blockNumber === null ? null : hex(blockNumber),
    transactionIndex: blockNumber === null ? null : '0x0', from, to: '0x0000000000000000000000000000000000000002', value: '0x1', gas: '0x5208',
    gasPrice: '0x3b9aca00', input: '0x', type: '0x0', chainId: '0x7a69', v: '0xf6e', r: `0x${'1'.repeat(64)}`, s: `0x${'2'.repeat(64)}`
  }
}

/** A node that answers the confirmation lookups from `state`, and records each call. */
async function node(state: NodeState): Promise<{ wallet: WalletDescriptor; calls: Array<{ method: string; params: unknown[] }> }> {
  const calls: Array<{ method: string; params: unknown[] }> = []
  server = createServer((request, response) => {
    let body = ''
    request.on('data', (chunk: Buffer) => { body += chunk.toString() })
    request.on('end', () => {
      const { id, method, params } = JSON.parse(body) as { id: number; method: string; params: unknown[] }
      calls.push({ method, params })
      const latest = state.latest ?? 100
      response.setHeader('content-type', 'application/json')
      const reply = (result: unknown) => response.end(JSON.stringify({ jsonrpc: '2.0', id, result }))
      const refuse = (code: number) => response.end(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message: 'backend unavailable' } }))
      if (method === 'eth_getTransactionReceipt') return reply(state.receipt ?? null)
      if (method === 'eth_getTransactionByHash') {
        if (state.lookupError !== undefined) return refuse(state.lookupError)
        return reply(state.holds ? transaction(HASH, ADDRESS, null) : null)
      }
      if (method === 'eth_blockNumber') return reply(hex(latest))
      if (method === 'eth_getTransactionCount') {
        if (state.countError !== undefined) return refuse(state.countError)
        const tag = params[1] as string
        if (tag === 'latest' && state.latestCount) return reply(state.latestCount)
        const block = tag === 'latest' ? latest : Number(tag)
        if (block < (state.oldestState ?? 0)) return refuse(-32000)
        return reply(state.usedIn !== undefined && block >= state.usedIn ? '0xa' : '0x9')
      }
      if (method === 'eth_getBlockByNumber') {
        const number = Number(params[0])
        if (state.block === 'missing') return reply(null)
        // Only transaction hashes are asked for.
        expect(params[1]).toBe(false)
        const transactions = number === state.usedIn && state.block !== 'empty' ? [`0x${'77'.repeat(32)}`, state.taker ?? OTHER_HASH] : []
        return reply({
          number: hex(number), hash: state.blockHash ?? `0x${'e'.repeat(64)}`, parentHash: `0x${'f'.repeat(64)}`, nonce: '0x0000000000000000',
          sha3Uncles: `0x${'0'.repeat(64)}`, logsBloom: `0x${'0'.repeat(512)}`, transactionsRoot: `0x${'0'.repeat(64)}`,
          stateRoot: `0x${'0'.repeat(64)}`, receiptsRoot: `0x${'0'.repeat(64)}`, miner: SOMEONE_ELSE, difficulty: '0x0',
          totalDifficulty: '0x0', extraData: '0x', size: '0x0', gasLimit: '0x1c9c380', gasUsed: '0x0', timestamp: '0x0',
          baseFeePerGas: '0x1', transactions, uncles: []
        })
      }
      refuse(-32601)
    })
  })
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', () => resolve()))
  const rpcUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  return {
    calls,
    wallet: {
      id: 'wallet-1', name: 'EVM', kind: 'imported', chainFamily: 'evm', publicAddress: ADDRESS,
      network: { id: '31337', name: 'Anvil', environment: 'local', rpcUrl },
      capabilities: ['read', 'sign', 'send'], workspaceIds: ['workspace-1'], policyIds: [], recoveryConfirmed: true,
      createdAt: '2026-08-28T12:00:00.000Z', updatedAt: '2026-08-28T12:00:00.000Z'
    }
  }
}

async function confirmation(state: NodeState, nonce?: string) {
  const { wallet, calls } = await node(state)
  try {
    const result = await new EvmWalletAdapter().confirmation(wallet, HASH, nonce)
    return { result, methods: calls.map((call) => call.method), calls }
  } finally {
    await new Promise<void>((resolve) => server!.close(() => resolve()))
    server = undefined
  }
}

describe('EVM confirmation of a replaced transaction', () => {
  it('reports a transaction as replaced once the block in which the account used its nonce does not hold it', async () => {
    // The account used nonce 9 in block 97 with another transaction, so this one can never be mined.
    const replaced = await confirmation({ usedIn: 97 }, '9')
    expect(replaced.result).toEqual({ confirmed: false, failed: false, replaced: true })
    expect(replaced.methods.slice(0, 4)).toEqual(['eth_getTransactionReceipt', 'eth_getTransactionCount', 'eth_getTransactionByHash', 'eth_blockNumber'])
    expect(replaced.calls[1]!.params).toEqual([ADDRESS, 'latest'])
    expect(replaced.calls.at(-1)).toEqual({ method: 'eth_getBlockByNumber', params: ['0x61', false] })
    // Something other than a transaction of the account's own can use the nonce, such as an EIP-7702 authorization.
    expect((await confirmation({ usedIn: 97, block: 'empty' }, '9')).result).toEqual({ confirmed: false, failed: false, replaced: true })

    // The block is found in few reads however far back it is, and also when it is the latest.
    const longAgo = await confirmation({ latest: 5_000_000, usedIn: 3 }, '9')
    expect(longAgo.result).toEqual({ confirmed: false, failed: false, replaced: true })
    expect(longAgo.calls.at(-1)).toEqual({ method: 'eth_getBlockByNumber', params: ['0x3', false] })
    expect(longAgo.methods.filter((method) => method === 'eth_getTransactionCount').length).toBeLessThanOrEqual(2 + 2 * 23)
    const latest = await confirmation({ usedIn: 100 }, '9')
    expect(latest.result).toEqual({ confirmed: false, failed: false, replaced: true })
    expect(latest.calls.at(-1)).toEqual({ method: 'eth_getBlockByNumber', params: ['0x64', false] })
  })

  it('keeps a mined transaction pending when the node has lost it, such as one lagging behind or one that pruned old transactions', async () => {
    // The node has no receipt and no transaction for this hash, but block 97 holds it, so it was mined.
    const lost = await confirmation({ usedIn: 97, taker: HASH }, '9')
    expect(lost.result).toEqual({ confirmed: false, failed: false })
    expect(lost.calls.at(-1)).toEqual({ method: 'eth_getBlockByNumber', params: ['0x61', false] })
    // A backend ahead of the one giving block numbers proves nothing until the other sees the block too.
    expect((await confirmation({ latestCount: '0xa' }, '9')).result).toEqual({ confirmed: false, failed: false })
  })

  it('leaves a check undecided when the node cannot show the block in which the account used the nonce', async () => {
    // The node keeps no account state for blocks before 99, so it cannot tell which block used the nonce.
    await expect(confirmation({ usedIn: 50, oldestState: 99 }, '9')).rejects.toThrow()
    await expect(confirmation({ usedIn: 97, block: 'missing' }, '9')).rejects.toThrow()
    // A node that shows the nonce used from the first block, such as one ignoring the block it is asked about.
    await expect(confirmation({ usedIn: 0 }, '9')).rejects.toThrow('EVM node shows the nonce used from the first block')
  })

  it('reads only the block it found on later checks, and searches again once the chain replaced that block', async () => {
    const state: NodeState = { usedIn: 97 }
    const { wallet, calls } = await node(state)
    const adapter = new EvmWalletAdapter()
    const replaced = { confirmed: false, failed: false, replaced: true }
    expect(await adapter.confirmation(wallet, HASH, '9')).toEqual(replaced)

    // Later the node keeps no account state that old, as on a chain with fast blocks.
    Object.assign(state, { latest: 400, oldestState: 300 })
    const before = calls.length
    expect(await adapter.confirmation(wallet, HASH, '9')).toEqual(replaced)
    expect(calls.slice(before).map((call) => call.method))
      .toEqual(['eth_getTransactionReceipt', 'eth_getTransactionCount', 'eth_getTransactionByHash', 'eth_getBlockByNumber'])
    expect(calls.at(-1)).toEqual({ method: 'eth_getBlockByNumber', params: ['0x61', false] })

    // Another block took its place, so the check searches again, and that needs the account state.
    state.blockHash = `0x${'9'.repeat(64)}`
    await expect(adapter.confirmation(wallet, HASH, '9')).rejects.toThrow()
    delete state.oldestState
    state.taker = HASH
    expect(await adapter.confirmation(wallet, HASH, '9')).toEqual({ confirmed: false, failed: false })
  })

  it('keeps a transaction pending while its nonce is free or the node holds it, and leaves an unanswered check undecided', async () => {
    const pending = { confirmed: false, failed: false }
    // Nonce 9 is the account's next nonce, so this transaction can still be mined, and one extra read decides it.
    const free = await confirmation({}, '9')
    expect(free.result).toEqual(pending)
    expect(free.methods).toEqual(['eth_getTransactionReceipt', 'eth_getTransactionCount'])
    // The node still holds it, for example a lagging backend behind the same RPC.
    expect((await confirmation({ holds: true, usedIn: 97 }, '9')).result).toEqual(pending)
    // A check the node cannot answer counts neither way, so the broker asks again.
    await expect(confirmation({ lookupError: -32000, usedIn: 97 }, '9')).rejects.toThrow()
    await expect(confirmation({ countError: -32000 }, '9')).rejects.toThrow()

    // Without the transaction's nonce there is nothing to compare, and no extra lookups.
    const withoutNonce = await confirmation({ usedIn: 97 })
    expect(withoutNonce.result).toEqual(pending)
    expect(withoutNonce.methods).toEqual(['eth_getTransactionReceipt'])
    expect((await confirmation({ usedIn: 97 }, 'not-a-nonce')).methods).toEqual(['eth_getTransactionReceipt'])
  })

  it('reads a mined receipt without the replacement lookups', async () => {
    const mined = await confirmation({
      receipt: {
        transactionHash: HASH, transactionIndex: '0x0', blockHash: `0x${'c'.repeat(64)}`, blockNumber: '0x7b', from: ADDRESS,
        to: '0x0000000000000000000000000000000000000002', cumulativeGasUsed: '0x5208', gasUsed: '0x5208', contractAddress: null,
        logs: [], logsBloom: `0x${'0'.repeat(512)}`, status: '0x1', effectiveGasPrice: '0x3b9aca00', type: '0x0'
      },
      usedIn: 97
    }, '9')
    expect(mined.result).toEqual({ confirmed: true, failed: false, blockReference: '123' })
    expect(mined.methods).toEqual(['eth_getTransactionReceipt'])
  })
})
