import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { createPublicClient, encodeErrorResult, http, parseAbi, type Hex } from 'viem'
import {
  decodeRevertData,
  evmRevertFromError,
  simulationRevertFromStored,
  storedSimulationRevert
} from '../src/main/wallet/evm-revert.js'

const ERRORS = parseAbi([
  'error Error(string)',
  'error Panic(uint256)',
  'error ERC20InsufficientAllowance(address spender, uint256 allowance, uint256 needed)',
  'error Unlisted(uint256 value)'
])
const errorString = (message: string) => encodeErrorResult({ abi: ERRORS, errorName: 'Error', args: [message] })
const panic = (code: bigint) => encodeErrorResult({ abi: ERRORS, errorName: 'Panic', args: [code] })
const ACCOUNT = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'
const TOKEN = '0x5FbDB2315678afecb367f032d93F642f64180aa3'

let server: Server | undefined

afterEach(async () => {
  await new Promise<void>((resolve) => server ? server.close(() => resolve()) : resolve())
  server = undefined
})

/** What viem throws for an eth_call when the node answers with this JSON-RPC error. */
async function callError(error: Record<string, unknown>): Promise<unknown> {
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
  const { port } = server.address() as AddressInfo
  const client = createPublicClient({ transport: http(`http://127.0.0.1:${port}/v1?apiKey=rpc-query-secret`, { retryCount: 0 }) })
  return client.call({ account: ACCOUNT, to: TOKEN, data: '0x23b872dd' }).then(
    () => { throw new Error('The call should have failed') },
    (error: unknown) => error
  )
}

describe('EVM revert reasons', () => {
  it('reads the reason from the revert data a node returns, never from its error message', async () => {
    const reverted = await callError({ code: 3, message: 'execution reverted: ERC20: insufficient allowance', data: errorString('ERC20: insufficient allowance') })
    expect(evmRevertFromError(reverted)).toEqual({ kind: 'message', message: 'ERC20: insufficient allowance' })
    expect(JSON.stringify(evmRevertFromError(reverted))).not.toMatch(/127\.0\.0\.1|rpc-query-secret/)

    // Nethermind and OpenEthereum send the data with a "Reverted " prefix; others wrap it in an object.
    expect(evmRevertFromError(await callError({ code: -32015, message: 'VM execution error.', data: `Reverted ${panic(0x11n)}` })))
      .toEqual({ kind: 'panic', code: '0x11' })
    const custom = encodeErrorResult({ abi: ERRORS, errorName: 'ERC20InsufficientAllowance', args: [ACCOUNT, 0n, 1n] })
    expect(evmRevertFromError(await callError({ code: 3, message: 'execution reverted', data: { data: custom } })))
      .toEqual({ kind: 'custom-error', selector: '0xfb8f41b2' })
  })

  it('tells a revert without data apart from failures that are not reverts', async () => {
    expect(evmRevertFromError(await callError({ code: -32000, message: 'execution reverted' }))).toEqual({ kind: 'no-reason' })
    expect(evmRevertFromError(await callError({ code: 3, message: 'execution reverted', data: '0x' }))).toEqual({ kind: 'no-reason' })
    expect(evmRevertFromError(await callError({ code: -32000, message: 'gas required exceeds allowance (0)' }))).toBeUndefined()
    expect(evmRevertFromError(await callError({ code: -32000, message: 'insufficient funds for gas * price + value' }))).toBeUndefined()
    expect(evmRevertFromError(new Error('fetch failed'))).toBeUndefined()
    expect(evmRevertFromError(undefined)).toBeUndefined()
  })

  it('keeps a revert message readable and short, and shows characters that would hide what it says', () => {
    expect(decodeRevertData(errorString('Pausable:\n  paused'))).toEqual({ kind: 'message', message: 'Pausable: paused' })
    // Wide Unicode spaces cannot push text apart to look like separate dialog lines.
    expect(decodeRevertData(errorString(`Swap failed${'\u2003'.repeat(40)}Approved\u3000by\u00a0Hronaut`)))
      .toEqual({ kind: 'message', message: 'Swap failed Approved by Hronaut' })
    expect(decodeRevertData(errorString('Swap‮failed'))).toEqual({ kind: 'message', message: 'Swap[U+202E]failed' })
    expect(decodeRevertData(errorString(''))).toEqual({ kind: 'no-reason' })
    const long = decodeRevertData(errorString('x'.repeat(5_000)))
    expect(long).toEqual({ kind: 'message', message: 'x'.repeat(200), truncated: true })
    // Data that is not a well-formed Error(string) or Panic(uint256) is reported by its selector.
    expect(decodeRevertData('0x08c379a0ff')).toEqual({ kind: 'custom-error', selector: '0x08c379a0' })
    expect(decodeRevertData('0x4e487b71')).toEqual({ kind: 'custom-error', selector: '0x4e487b71' })
    expect(decodeRevertData('0x1234')).toEqual({ kind: 'no-reason' })
  })

  it('stores a reason in text older versions accept, and names known errors when it is read back', () => {
    const stored = (data: Hex) => simulationRevertFromStored(storedSimulationRevert(decodeRevertData(data)))
    expect(stored(panic(0x11n))).toEqual({ kind: 'panic', code: '0x11', meaning: 'arithmetic overflow or underflow' })
    expect(stored(panic(0x99n))).toEqual({ kind: 'panic', code: '0x99' })
    expect(stored(encodeErrorResult({ abi: ERRORS, errorName: 'ERC20InsufficientAllowance', args: [ACCOUNT, 0n, 1n] })))
      .toEqual({ kind: 'custom-error', selector: '0xfb8f41b2', name: 'ERC20InsufficientAllowance' })
    expect(stored(encodeErrorResult({ abi: ERRORS, errorName: 'Unlisted', args: [1n] }))).toEqual({ kind: 'custom-error', selector: expect.stringMatching(/^0x[0-9a-f]{8}$/) })
    expect(stored(errorString('Too little received'))).toEqual({ kind: 'message', message: 'Too little received' })

    // The longest message, made of characters JSON must escape, still fits the 512-character simulation error.
    const quoted = storedSimulationRevert(decodeRevertData(errorString('"\\'.repeat(400))))
    expect(quoted?.length).toBeLessThanOrEqual(512)
    expect(simulationRevertFromStored(quoted)).toMatchObject({ kind: 'message', truncated: true })

    // Other simulation errors, including those older versions stored, have no revert reason.
    expect(simulationRevertFromStored('Wallet transaction simulation failed')).toBeUndefined()
    expect(simulationRevertFromStored('revert:{"kind":"message"}')).toBeUndefined()
    expect(simulationRevertFromStored('revert:not json')).toBeUndefined()
    expect(simulationRevertFromStored('revert:{"kind":"custom-error","selector":"0xfb8f41b2","url":"https://rpc.example"}')).toBeUndefined()
    expect(simulationRevertFromStored(undefined)).toBeUndefined()
  })
})
