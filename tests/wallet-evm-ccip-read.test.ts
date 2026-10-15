import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { encodeAbiParameters, encodeErrorResult, parseAbi, type Hex } from 'viem'
import { EvmWalletAdapter } from '../src/main/wallet/adapters/evm.js'
import { simulationRevertFromStored, storedSimulationRevert } from '../src/main/wallet/evm-revert.js'
import type { WalletDescriptor } from '../src/shared/wallet.js'

const TOKEN = '0x5FbDB2315678afecb367f032d93F642f64180aa3'
const CALLBACK = '0x12345678'
const OFFCHAIN_LOOKUP = parseAbi(['error OffchainLookup(address sender, string[] urls, bytes callData, bytes4 callbackFunction, bytes extraData)'])

const servers: Server[] = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))))
})

async function listen(handler: (body: string, url: string) => unknown): Promise<string> {
  const server = createServer((request, response) => {
    let body = ''
    request.on('data', (chunk: Buffer) => { body += chunk.toString() })
    request.on('end', () => {
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify(handler(body, request.url ?? '')))
    })
  })
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}

function wallet(rpcUrl: string): WalletDescriptor {
  return {
    id: 'wallet-1', name: 'EVM', kind: 'imported', chainFamily: 'evm',
    publicAddress: '0x9858EfFD232B4033E47d90003D41EC34EcaEda94',
    network: { id: '31337', name: 'Anvil', environment: 'local', rpcUrl },
    capabilities: ['read', 'sign', 'send'], workspaceIds: ['workspace-1'], policyIds: [], recoveryConfirmed: true,
    createdAt: '2026-08-28T12:00:00.000Z', updatedAt: '2026-08-28T12:00:00.000Z'
  }
}

describe('EVM adapter CCIP-Read', () => {
  it('never fetches the URLs a contract names in an offchain lookup revert', async () => {
    // A gateway on the local network, which a contract can name like any other URL.
    const gatewayRequests: string[] = []
    const gateway = await listen((_body, url) => {
      gatewayRequests.push(url)
      return { data: '0x' }
    })
    // A token whose every call asks the wallet to fetch that gateway, and whose callback answers 6 decimals.
    const node = await listen((body) => {
      const { id, method, params } = JSON.parse(body) as { id: number; method: string; params: Array<{ data?: Hex }> }
      if (method === 'eth_chainId') return { jsonrpc: '2.0', id, result: '0x7a69' }
      const data = params[0]?.data ?? '0x'
      if (data.startsWith(CALLBACK)) return { jsonrpc: '2.0', id, result: encodeAbiParameters([{ type: 'uint8' }], [6]) }
      const lookup = encodeErrorResult({
        abi: OFFCHAIN_LOOKUP, errorName: 'OffchainLookup', args: [TOKEN, [`${gateway}/{sender}/{data}.json`], data, CALLBACK, '0x']
      })
      return { jsonrpc: '2.0', id, error: { code: 3, message: 'execution reverted', data: lookup } }
    })
    const adapter = new EvmWalletAdapter()

    // A page's wallet_watchAsset reads these without any permission.
    await expect(adapter.tokenContractDetails(wallet(node), TOKEN)).resolves.toEqual({})
    await expect(adapter.tokenBalance(wallet(node), TOKEN)).rejects.toThrow()
    const transaction = {
      chainFamily: 'evm' as const, networkId: '31337', signer: wallet(node).publicAddress,
      raw: { account: wallet(node).publicAddress, to: TOKEN, data: '0x313ce567', gas: 100_000n, gasPrice: 1n },
      decoded: { understood: false, destination: TOKEN, method: 'contract-call:0x313ce567', nativeAmount: '0', unlimitedAllowance: false, newContractOrProgram: false, blindMessage: false }
    }
    const simulation = await adapter.simulate(wallet(node), transaction)
    expect(simulation).toMatchObject({ attempted: true, success: false, revert: { kind: 'custom-error', selector: '0x556f1830' } })
    // The approval dialog and agents name it.
    expect(simulationRevertFromStored(storedSimulationRevert(simulation.revert!))).toEqual({
      kind: 'custom-error', selector: '0x556f1830', name: 'OffchainLookup'
    })
    expect(gatewayRequests).toEqual([])
  })
})
