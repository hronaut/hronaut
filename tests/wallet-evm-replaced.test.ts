import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { EvmWalletAdapter } from '../src/main/wallet/adapters/evm.js'
import type { WalletDescriptor } from '../src/shared/wallet.js'

const HASH = `0x${'ab'.repeat(32)}`
const ADDRESS = '0x9858EfFD232B4033E47d90003D41EC34EcaEda94'

let server: Server | undefined

afterEach(async () => {
  await new Promise<void>((resolve) => server ? server.close(() => resolve()) : resolve())
  server = undefined
})

interface NodeState {
  receipt?: Record<string, unknown>
  /** Whether the node still holds the transaction. */
  holds?: boolean
  /** The account's mined transaction count, or an error code. */
  count?: string | { code: number }
  /** An error code eth_getTransactionByHash answers with. */
  lookupError?: number
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
      response.setHeader('content-type', 'application/json')
      const reply = (result: unknown) => response.end(JSON.stringify({ jsonrpc: '2.0', id, result }))
      const refuse = (code: number) => response.end(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message: 'backend unavailable' } }))
      if (method === 'eth_getTransactionReceipt') return reply(state.receipt ?? null)
      if (method === 'eth_getTransactionByHash') {
        if (state.lookupError !== undefined) return refuse(state.lookupError)
        return reply(state.holds ? {
          hash: HASH, nonce: '0x9', blockHash: null, blockNumber: null, transactionIndex: null, from: ADDRESS,
          to: '0x0000000000000000000000000000000000000002', value: '0x1', gas: '0x5208', gasPrice: '0x3b9aca00',
          input: '0x', type: '0x0', chainId: '0x7a69', v: '0xf6e', r: `0x${'1'.repeat(64)}`, s: `0x${'2'.repeat(64)}`
        } : null)
      }
      if (method === 'eth_getTransactionCount') {
        return typeof state.count === 'object' ? refuse(state.count.code) : reply(state.count ?? '0x0')
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
  const result = await new EvmWalletAdapter().confirmation(wallet, HASH, nonce)
  await new Promise<void>((resolve) => server!.close(() => resolve()))
  server = undefined
  return { result, methods: calls.map((call) => call.method), calls }
}

describe('EVM confirmation of a replaced transaction', () => {
  it('reports a transaction as replaced when the node dropped it and the account already mined its nonce', async () => {
    // The account has mined nonces 0 to 9, so nonce 9 went to another transaction.
    const replaced = await confirmation({ count: '0xa' }, '9')
    expect(replaced.result).toEqual({ confirmed: false, failed: false, replaced: true })
    expect(replaced.methods).toEqual(['eth_getTransactionReceipt', 'eth_getTransactionByHash', 'eth_getTransactionCount'])
    expect(replaced.calls[2]!.params).toEqual([ADDRESS, 'latest'])
  })

  it('keeps a transaction pending while its nonce is free, the node holds it, or the node cannot answer', async () => {
    const pending = { confirmed: false, failed: false }
    // Nonce 9 is the account's next nonce, so this transaction can still be mined.
    expect((await confirmation({ count: '0x9' }, '9')).result).toEqual(pending)
    // The node still holds it, for example a lagging backend behind the same RPC.
    expect((await confirmation({ holds: true, count: '0xa' }, '9')).result).toEqual(pending)
    expect((await confirmation({ lookupError: -32000, count: '0xa' }, '9')).result).toEqual(pending)
    expect((await confirmation({ count: { code: -32000 } }, '9')).result).toEqual(pending)

    // Without the transaction's nonce there is nothing to compare, and no extra lookups.
    const withoutNonce = await confirmation({ count: '0xa' })
    expect(withoutNonce.result).toEqual(pending)
    expect(withoutNonce.methods).toEqual(['eth_getTransactionReceipt'])
    expect((await confirmation({ count: '0xa' }, 'not-a-nonce')).methods).toEqual(['eth_getTransactionReceipt'])
  })

  it('reads a mined receipt without the replacement lookups', async () => {
    const mined = await confirmation({
      receipt: {
        transactionHash: HASH, transactionIndex: '0x0', blockHash: `0x${'c'.repeat(64)}`, blockNumber: '0x7b', from: ADDRESS,
        to: '0x0000000000000000000000000000000000000002', cumulativeGasUsed: '0x5208', gasUsed: '0x5208', contractAddress: null,
        logs: [], logsBloom: `0x${'0'.repeat(512)}`, status: '0x1', effectiveGasPrice: '0x3b9aca00', type: '0x0'
      },
      count: '0xa'
    }, '9')
    expect(mined.result).toEqual({ confirmed: true, failed: false, blockReference: '123' })
    expect(mined.methods).toEqual(['eth_getTransactionReceipt'])
  })
})
