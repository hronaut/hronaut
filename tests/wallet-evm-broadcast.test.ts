import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { keccak256 } from 'viem'
import { EvmWalletAdapter } from '../src/main/wallet/adapters/evm.js'
import type { WalletDescriptor } from '../src/shared/wallet.js'

const SIGNED = '0x02f86b827a69808459682f0084773594008252089400000000000000000000000000000000000000020180c080a0'

let server: Server | undefined

afterEach(async () => {
  await new Promise<void>((resolve) => server ? server.close(() => resolve()) : resolve())
  server = undefined
})

/** A pending transaction as a node returns it from eth_getTransactionByHash. */
function pendingTransaction(hash: string): Record<string, unknown> {
  return {
    hash, nonce: '0x9', blockHash: null, blockNumber: null, transactionIndex: null,
    from: '0x9858EfFD232B4033E47d90003D41EC34EcaEda94', to: '0x3535353535353535353535353535353535353535',
    value: '0xde0b6b3a7640000', gas: '0x5208', gasPrice: '0x4a817c800', input: '0x', type: '0x0', chainId: '0x1',
    v: '0x25', r: '0x28ef61340bd939bc2195fe537567866003e1a15d3c71ff63e1590620aa636276',
    s: '0x67cbe9d8997f761aecb703304b3800ccf555c9f3dc64214b297fb1966a3b6d83'
  }
}

/**
 * A node that refuses every transaction with this JSON-RPC error, behind an RPC
 * URL that holds a key, and that holds the transactions in `held` by hash.
 */
async function refusingNode(error: Record<string, unknown>, held: readonly string[] = []): Promise<WalletDescriptor> {
  server = createServer((request, response) => {
    let body = ''
    request.on('data', (chunk: Buffer) => { body += chunk.toString() })
    request.on('end', () => {
      const { id, method, params } = JSON.parse(body) as { id: number; method: string; params: unknown[] }
      response.setHeader('content-type', 'application/json')
      if (method !== 'eth_getTransactionByHash') return response.end(JSON.stringify({ jsonrpc: '2.0', id, error }))
      const hash = params[0] as string
      response.end(JSON.stringify({ jsonrpc: '2.0', id, result: held.includes(hash) ? pendingTransaction(hash) : null }))
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
      .toBe('EVM RPC error (code -32000): the node refused the transaction: gas price is too low for the node to accept it')
    expect(await refusal('transaction gas price below minimum: gas tip cap 0, minimum needed 1'))
      .toBe('EVM RPC error (code -32000): the node refused the transaction: gas price is too low for the node to accept it')
    expect(await refusal('max fee per gas less than block base fee: address 0x9858, maxFeePerGas: 1 baseFee: 7'))
      .toBe('EVM RPC error (code -32000): the node refused the transaction: max fee per gas is below the block base fee')
    expect(await refusal('intrinsic gas too low: gas 21000, minimum needed 53000'))
      .toBe('EVM RPC error (code -32000): the node refused the transaction: gas limit is below the minimum for this transaction')
    expect(await refusal('exceeds block gas limit', -32003))
      .toBe('EVM RPC error (code -32003): the node refused the transaction: gas limit is above what the network allows')
    // Besu and Hardhat wordings.
    expect(await refusal('Upfront cost exceeds account balance', -32004))
      .toBe('EVM RPC error (code -32004): the node refused the transaction: the account cannot pay for gas and value')
    expect(await refusal("Sender doesn't have enough funds to send tx. The max upfront cost is: 21000"))
      .toBe('EVM RPC error (code -32000): the node refused the transaction: the account cannot pay for gas and value')
    expect(await refusal('Wrong chainId'))
      .toBe('EVM RPC error (code -32000): the node refused the transaction: the transaction is for another chain')
    // Geth wraps signer errors in "invalid sender"; the more specific reason wins.
    expect(await refusal('invalid sender: invalid chain id for signer: have 1 want 31337'))
      .toBe('EVM RPC error (code -32000): the node refused the transaction: the transaction is for another chain')
    expect(await refusal('invalid sender: transaction type not supported'))
      .toBe('EVM RPC error (code -32000): the node refused the transaction: the network does not support this transaction type')
    // A code outside the JSON-RPC server range never reaches the page, so 4001 cannot read as "the person rejected it".
    expect(await refusal('nonce too high', 4001))
      .toBe('EVM RPC error (code -32000): the node refused the transaction: nonce too high, an earlier nonce has not been sent')
    expect(await refusal('nonce too high', 5720))
      .toBe('EVM RPC error (code -32000): the node refused the transaction: nonce too high, an earlier nonce has not been sent')
    // "unknown transaction" is not "known transaction".
    expect(await refusal('unknown transaction status')).not.toMatch(/node refused/)
    // Anything else keeps the original error, which the broker turns into its generic message.
    expect(await refusal('https://rpc.example.invalid/?apiKey=rpc-query-secret is rate limited')).toContain('rate limited')
  })

  it('counts a transaction the node already has as sent, under its own hash, while the node holds it', async () => {
    const adapter = new EvmWalletAdapter()
    const broadcast = async (message: string, signed: string, held: readonly string[]) => {
      try {
        return await adapter.broadcast(await refusingNode({ code: -32000, message }, held), signed)
      } catch (error) {
        return (error as Error).message
      } finally {
        await new Promise<void>((resolve) => server!.close(() => resolve()))
        server = undefined
      }
    }
    const hash = keccak256(SIGNED)
    // Geth, Nethermind (old and new), Erigon, Besu and Hardhat, Anvil, OpenEthereum and Cosmos EVM wordings.
    for (const message of [
      'already known', 'AlreadyKnown', 'ALREADY_EXISTS: already known', 'Known transaction: 6ba7b8',
      'transaction already imported', 'Transaction with the same hash was already imported.',
      'existing txn with same hash', 'tx already exists in cache'
    ]) expect(await broadcast(message, SIGNED, [hash]), message).toBe(hash)
    // The EIP-155 example transaction, whose published hash ethers computes too.
    const legacy = '0xf86c098504a817c800825208943535353535353535353535353535353535353535880de0b6b3a76400008025a028ef61340bd939bc2195fe537567866003e1a15d3c71ff63e1590620aa636276a067cbe9d8997f761aecb703304b3800ccf555c9f3dc64214b297fb1966a3b6d83'
    const legacyHash = '0x33469b22e9f636356c4160a87eb19df52b7412e8eac32a4a55ffe88ea8350788'
    expect(await broadcast('already known', legacy, [legacyHash])).toBe(legacyHash)

    // Nethermind and Erigon also say so for a transaction they rejected or dropped, which the node no longer holds.
    const refused = 'EVM RPC error (code -32000): the node refused the transaction: the node says it already has this transaction'
    expect(await broadcast('already known', SIGNED, [])).toBe(refused)
    // A blob transaction's hash is not the hash of the bytes sent, so it is never assumed.
    const blob = `0x03${SIGNED.slice(4)}`
    expect(await broadcast('already known', blob, [keccak256(blob as `0x${string}`)])).toBe(refused)
  })
})
