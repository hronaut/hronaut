import { spawn } from 'node:child_process'
import { encodeAbiParameters, encodeFunctionData, erc20Abi, type Address, type Hex } from 'viem'
import { QA_TOKEN_BYTECODE } from '../fixtures/qa-token/qa-token.js'

/** A local Foundry Anvil node for one test, with its accounts unlocked and every transaction mined at once. */
export interface AnvilChain {
  url: string
  chainId: number
  rpc<T = unknown>(method: string, params?: unknown[]): Promise<T>
  stop(): Promise<void>
}

/** Anvil's first default account; its key is public, so it only ever holds local test funds. */
export const ANVIL_ACCOUNT = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'
export const ANVIL_ACCOUNT_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
/** Anvil's last default account, which deploys contracts so the first account's nonces stay the wallet's. */
const ANVIL_DEPLOYER = '0xa0Ee7A142d267C1f36714E4a8F75612F20a79720'

/** Starts Anvil on a free port: HRONAUT_ANVIL names the binary, otherwise anvil on PATH (the Docker test image has it). */
export async function startAnvil(chainId = 31337): Promise<AnvilChain> {
  const binary = process.env.HRONAUT_ANVIL || 'anvil'
  const child = spawn(binary, ['--host', '127.0.0.1', '--port', '0', '--chain-id', String(chainId)], { stdio: ['ignore', 'pipe', 'pipe'] })
  const url = await new Promise<string>((resolve, reject) => {
    let output = ''
    const fail = (error: Error) => {
      clearTimeout(timer)
      child.kill('SIGKILL')
      reject(error)
    }
    const timer = setTimeout(() => fail(new Error(`Anvil did not start within 15 seconds:\n${output}`)), 15_000)
    child.once('error', (error: NodeJS.ErrnoException) => fail(error.code === 'ENOENT'
      ? new Error(`Anvil was not found as "${binary}". Install Foundry's anvil or set HRONAUT_ANVIL; the Docker test image includes it.`)
      : error))
    child.once('exit', (code) => fail(new Error(`Anvil exited with ${code} before it was ready:\n${output}`)))
    child.stderr.on('data', (chunk: Buffer) => { output += chunk.toString() })
    child.stdout.on('data', function listening(chunk: Buffer) {
      output += chunk.toString()
      const address = /Listening on (127\.0\.0\.1:\d+)/.exec(output)?.[1]
      if (!address) return
      clearTimeout(timer)
      child.removeAllListeners('exit')
      child.stdout.off('data', listening)
      // Anvil logs every call; keep reading so its output pipe never fills.
      child.stdout.resume()
      resolve(`http://${address}`)
    })
  })
  let id = 0
  const rpc = async <T,>(method: string, params: unknown[] = []): Promise<T> => {
    const response = await fetch(url, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params })
    })
    const body = await response.json() as { result?: T; error?: { message: string } }
    if (body.error) throw new Error(`Anvil ${method} failed: ${body.error.message}`)
    return body.result as T
  }
  const stop = () => new Promise<void>((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) return resolve()
    child.once('exit', () => resolve())
    child.kill('SIGTERM')
  })
  return { url, chainId, rpc, stop }
}

/** Deploys the QA token (6 decimals, symbol QAUSD) with its whole supply on the holder; returns its address. */
export async function deployQaToken(chain: AnvilChain, holder: Address, amount: bigint): Promise<Address> {
  const data = `${QA_TOKEN_BYTECODE}${encodeAbiParameters([{ type: 'address' }, { type: 'uint256' }], [holder, amount]).slice(2)}` as Hex
  const hash = await chain.rpc<Hex>('eth_sendTransaction', [{ from: ANVIL_DEPLOYER, data }])
  // Anvil mines at once, but the receipt can reach its RPC a moment later.
  for (let attempt = 0; attempt < 100; attempt++) {
    const receipt = await chain.rpc<{ status: Hex; contractAddress: Address } | null>('eth_getTransactionReceipt', [hash])
    if (receipt?.status === '0x1') return receipt.contractAddress
    if (receipt) throw new Error('QA token deployment reverted')
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error('QA token deployment was not mined within 5 seconds')
}

export async function tokenBalance(chain: AnvilChain, token: Address, account: Address): Promise<bigint> {
  return BigInt(await chain.rpc<Hex>('eth_call', [{ to: token, data: encodeFunctionData({ abi: erc20Abi, functionName: 'balanceOf', args: [account] }) }, 'latest']))
}

export async function nativeBalance(chain: AnvilChain, account: Address): Promise<bigint> {
  return BigInt(await chain.rpc<Hex>('eth_getBalance', [account, 'latest']))
}
