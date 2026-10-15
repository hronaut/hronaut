import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { EvmWalletAdapter } from '../src/main/wallet/adapters/evm.js'
import type { WalletDescriptor } from '../src/shared/wallet.js'

const SIGNED = '0x02f86b827a69808459682f0084773594008252089400000000000000000000000000000000000000020180c080a0'

let server: Server | undefined

afterEach(async () => {
  await new Promise<void>((resolve) => server ? server.close(() => resolve()) : resolve())
  server = undefined
})

/** A node that refuses every transaction with this JSON-RPC error, behind an RPC URL that holds a key. */
async function refusingNode(error: Record<string, unknown>): Promise<WalletDescriptor> {
  server = createServer((request, response) => {
    let body = ''
    request.on('data', (chunk: Buffer) => { body += chunk.toString() })
    request.on('end', () => {
      const { id } = JSON.parse(body) as { id: number }
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify({ jsonrpc: '2.0', id, error }))
    })
  })
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', () => resolve()))
  const rpcUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1?apiKey=rpc-query-secret`
  return {
    id: 'wallet-1', name: 'EVM', kind: 'imported', chainFamily: 'evm',
    publicAddress: '0x9858EfFD232B4033E47d90003D41EC34EcaEda94',
    network: { id: '31337', name: 'Anvil', environment: 'local', rpcUrl },
    capabilities: ['read', 'sign', 'send'], workspaceIds: ['workspace-1'], policyIds: [], recoveryConfirmed: true,
    createdAt: '2026-08-28T12:00:00.000Z', updatedAt: '2026-08-28T12:00:00.000Z'
  }
}

describe('EVM broadcast refusals', () => {
  it('says why the node refused a signed transaction, in Hronaut words rather than the node text', async () => {
    const adapter = new EvmWalletAdapter()
    const refusal = async (message: string, code = -32000) => {
      const error = await adapter.broadcast(await refusingNode({ code, message }), SIGNED).then(
        () => { throw new Error('The broadcast should have failed') },
        (cause: unknown) => cause as Error
      )
      await new Promise<void>((resolve) => server!.close(() => resolve()))
      server = undefined
      if (/node refused/.test(error.message)) expect(error.message).not.toMatch(/127\.0\.0\.1|rpc-query-secret|0x9858|21000/)
      return error.message
    }

    // Geth, Nethermind, Erigon, Anvil and hosted RPC wordings.
    expect(await refusal('insufficient funds for gas * price + value: address 0x9858EfFD232B4033E47d90003D41EC34EcaEda94 have 0 want 21000'))
      .toBe('EVM RPC error (code -32000): the node refused the transaction: the account cannot pay for gas and value')
    expect(await refusal('nonce too low: next nonce 5, tx nonce 3'))
      .toBe('EVM RPC error (code -32000): the node refused the transaction: nonce too low, the account already used this nonce')
    expect(await refusal('replacement transaction underpriced'))
      .toBe('EVM RPC error (code -32000): the node refused the transaction: replacement transaction underpriced')
    expect(await refusal('transaction underpriced: tip needed 1, tip permitted 0'))
      .toBe('EVM RPC error (code -32000): the node refused the transaction: gas price is below the node minimum')
    expect(await refusal('max fee per gas less than block base fee: address 0x9858, maxFeePerGas: 1 baseFee: 7'))
      .toBe('EVM RPC error (code -32000): the node refused the transaction: max fee per gas is below the block base fee')
    expect(await refusal('already known'))
      .toBe('EVM RPC error (code -32000): the node refused the transaction: the node already has this transaction')
    expect(await refusal('intrinsic gas too low: gas 21000, minimum needed 53000'))
      .toBe('EVM RPC error (code -32000): the node refused the transaction: gas limit is below the minimum for this transaction')
    expect(await refusal('exceeds block gas limit', -32003))
      .toBe('EVM RPC error (code -32003): the node refused the transaction: gas limit is above what the network allows')
    // Anything else keeps the original error, which the broker turns into its generic message.
    expect(await refusal('https://rpc.example.invalid/?apiKey=rpc-query-secret is rate limited')).toContain('rate limited')
  })
})
