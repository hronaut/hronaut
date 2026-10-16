import { readFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { keccak256, parseTransaction, type Hex } from 'viem'
import { closeFixtureServer } from './fixtures.js'
import { expect, test, text } from './capability-fixtures.js'

interface CallBatch {
  id: string
  networkId: string
  calls: number
  state: string
  transactions: Array<{ transactionHash: string; status: string }>
}

// A minimal EVM JSON-RPC chain (chain ID 31337) that mines every submitted transaction at once.
async function startLocalChain(): Promise<{ server: Server; url: string; rawTransactions: Hex[] }> {
  const rawTransactions: Hex[] = []
  const block = {
    number: '0x10', hash: `0x${'b'.repeat(64)}`, parentHash: `0x${'a'.repeat(64)}`, timestamp: '0x6700000',
    baseFeePerGas: '0x3b9aca00', gasLimit: '0x1c9c380', gasUsed: '0x0', miner: `0x${'0'.repeat(40)}`, transactions: [],
    uncles: [], nonce: '0x0000000000000000', difficulty: '0x0', extraData: '0x', logsBloom: `0x${'0'.repeat(512)}`, size: '0x200',
    stateRoot: `0x${'c'.repeat(64)}`, receiptsRoot: `0x${'d'.repeat(64)}`, transactionsRoot: `0x${'e'.repeat(64)}`,
    sha3Uncles: `0x${'f'.repeat(64)}`, mixHash: `0x${'0'.repeat(64)}`
  }
  const answer = (method: string, params: unknown[]): unknown => {
    switch (method) {
      case 'eth_chainId': return '0x7a69'
      case 'eth_blockNumber': return '0x10'
      case 'eth_getBalance': return '0xde0b6b3a7640000'
      case 'eth_getTransactionCount': return `0x${rawTransactions.length.toString(16)}`
      case 'eth_getBlockByNumber': return block
      case 'eth_maxPriorityFeePerGas': return '0x3b9aca00'
      case 'eth_gasPrice': return '0x77359400'
      case 'eth_estimateGas': return '0x5208'
      case 'eth_call': return '0x'
      case 'eth_sendRawTransaction': {
        rawTransactions.push(params[0] as Hex)
        return keccak256(params[0] as Hex)
      }
      case 'eth_getTransactionReceipt': {
        const raw = rawTransactions.find((entry) => keccak256(entry) === params[0])
        if (!raw) return null
        return {
          transactionHash: params[0], transactionIndex: '0x0', blockHash: `0x${'b'.repeat(64)}`, blockNumber: '0x11',
          from: `0x${'0'.repeat(40)}`, to: parseTransaction(raw).to ?? null, cumulativeGasUsed: '0x5208', gasUsed: '0x5208',
          effectiveGasPrice: '0x77359400', contractAddress: null, logs: [], logsBloom: `0x${'0'.repeat(512)}`, status: '0x1', type: '0x2'
        }
      }
      default: throw Object.assign(new Error(`Method ${method} is not available`), { code: -32601 })
    }
  }
  const server = createServer((request, response) => {
    let body = ''
    request.on('data', (chunk: Buffer) => { body += chunk.toString() })
    request.on('end', () => {
      let reply: Record<string, unknown>
      let id: unknown = null
      try {
        const call = JSON.parse(body) as { id: unknown; method: string; params?: unknown[] }
        id = call.id
        reply = { result: answer(call.method, call.params ?? []) }
      } catch (error) {
        reply = { error: { code: (error as { code?: number }).code ?? -32700, message: (error as Error).message } }
      }
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ jsonrpc: '2.0', id, ...reply }))
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  return { server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, rawTransactions }
}

test('sends the wallet QA fixture\'s batch one approved call at a time, for the page and its agent', async ({ capabilities, appWindow, electronApp }) => {
  const { client, workspace, tabId } = capabilities
  const chain = await startLocalChain()
  const fixture = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
    response.end(readFileSync('examples/wallet-qa/index.html'))
  })
  await new Promise<void>((resolve) => fixture.listen(0, '127.0.0.1', resolve))
  try {
    const pageUrl = `http://127.0.0.1:${(fixture.address() as AddressInfo).port}/`
    const vaultStatus = await appWindow.evaluate('window.hronautWallets.status()') as { managedWallets: string }
    if (vaultStatus.managedWallets === 'passphrase-setup-required') {
      await appWindow.evaluate(`window.hronautWallets.setupPassphrase('wallet qa batch integration passphrase')`)
    }
    // Anvil's first development key on the local chain above.
    const prepared = await appWindow.evaluate(`window.hronautWallets.prepareImport('evm', 'private-key',
      '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80')`) as { token: string }
    await appWindow.evaluate(`window.hronautWallets.confirmImport(${JSON.stringify(prepared.token)}, {
      name: 'Batch wallet', network: { id: '31337', name: 'Local chain', environment: 'local', rpcUrl: ${JSON.stringify(chain.url)} },
      workspaceIds: [${JSON.stringify(workspace.workspaceId)}], dedicatedAgent: false
    })`)
    const navigated = await client.callTool({ name: 'browser_navigate', arguments: { tabId, url: pageUrl } }) as CallToolResult
    expect(navigated.isError, text(navigated)).not.toBe(true)
    const listed = await client.callTool({ name: 'wallet_list', arguments: { tabId, agentName: 'dApp QA agent' } }) as CallToolResult
    expect(listed.isError, text(listed)).not.toBe(true)
    const { walletSessionId } = JSON.parse(text(listed)) as { walletSessionId: string }
    const callBatches = async () => {
      const result = await client.callTool({ name: 'wallet_page_requests', arguments: { tabId, walletSessionId } }) as CallToolResult
      expect(result.isError, text(result)).not.toBe(true)
      return (JSON.parse(text(result)) as { callBatches?: CallBatch[] }).callBatches
    }
    const page = (script: string) => electronApp.evaluate(({ webContents }, [url, source]) => {
      const contents = webContents.getAllWebContents().find((candidate) => candidate.getURL() === url)
      if (!contents) throw new Error('Wallet QA batch fixture WebContents was not found')
      return contents.executeJavaScript(source)
    }, [pageUrl, script] as const)
    const awaitingHuman = async () => (await appWindow.evaluate('window.hronautWallets.listRequests()') as Array<{ id: string; status: string; operation: string }>)
      .filter(({ status }) => status === 'awaiting-human')
    const approveNext = async (operation: string) => {
      await expect.poll(async () => (await awaitingHuman()).map((request) => request.operation)).toEqual([operation])
      await appWindow.evaluate(`window.hronautWallets.approveRequest(${JSON.stringify((await awaitingHuman())[0]!.id)})`)
    }

    await page(`document.querySelector('#connect').click(); 'clicked';`)
    await approveNext('connect-account')
    await expect.poll(() => page(`document.querySelector('#log').textContent`)).toContain('"accountCount": 1')

    await page(`document.querySelector('#send-batch').click(); 'clicked';`)
    // Each call is its own approval, and the second is prepared only after the first is mined.
    await approveNext('sign-and-send-transaction')
    await expect.poll(() => chain.rawTransactions.length).toBe(1)
    await approveNext('sign-and-send-transaction')
    await expect.poll(() => chain.rawTransactions.length).toBe(2)

    await expect.poll(() => page(`document.querySelector('#log').textContent`), { timeout: 15_000 }).toMatch(/"status": 200,\s+"receiptCount": 2/)
    await expect.poll(callBatches).toEqual([{
      id: expect.stringMatching(/^0x[0-9a-f]{64}$/), networkId: '31337', calls: 2, state: 'sent',
      transactions: chain.rawTransactions.map((raw) => ({ transactionHash: keccak256(raw), status: 'confirmed' }))
    }])
  } finally {
    await closeFixtureServer(fixture)
    await closeFixtureServer(chain.server)
  }
})
