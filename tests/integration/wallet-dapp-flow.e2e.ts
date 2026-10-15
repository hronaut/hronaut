import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { keccak256, parseTransaction, type Hex } from 'viem'
import { expect, test, text } from './capability-fixtures.js'

interface PageRequestList {
  origin: string
  requests: Array<{ id: string; operation: string; status: string; transactionHash?: string }>
}

interface LocalChain {
  server: Server
  url: string
  methods: string[]
  rawTransactions: Hex[]
}

// A minimal EVM JSON-RPC chain (chain ID 31337) that mines every submitted transaction at once.
function startLocalChain(): Promise<LocalChain> {
  const methods: string[] = []
  const rawTransactions: Hex[] = []
  const block = (number: number) => ({
    number: `0x${number.toString(16)}`, hash: `0x${'b'.repeat(64)}`, parentHash: `0x${'a'.repeat(64)}`,
    timestamp: '0x6700000', baseFeePerGas: '0x3b9aca00', gasLimit: '0x1c9c380', gasUsed: '0x0',
    miner: `0x${'0'.repeat(40)}`, transactions: [], uncles: [], nonce: '0x0000000000000000', difficulty: '0x0',
    extraData: '0x', logsBloom: `0x${'0'.repeat(512)}`, size: '0x200', stateRoot: `0x${'c'.repeat(64)}`,
    receiptsRoot: `0x${'d'.repeat(64)}`, transactionsRoot: `0x${'e'.repeat(64)}`, sha3Uncles: `0x${'f'.repeat(64)}`, mixHash: `0x${'0'.repeat(64)}`
  })
  const answer = (method: string, params: unknown[]): unknown => {
    switch (method) {
      case 'eth_chainId': return '0x7a69'
      case 'eth_blockNumber': return '0x10'
      case 'eth_getBalance': return '0xde0b6b3a7640000'
      case 'eth_getTransactionCount': return `0x${rawTransactions.length.toString(16)}`
      case 'eth_getBlockByNumber': return block(16)
      case 'eth_maxPriorityFeePerGas': return '0x3b9aca00'
      case 'eth_gasPrice': return '0x77359400'
      case 'eth_estimateGas': return '0x5208'
      case 'eth_call': return '0x'
      case 'eth_sendRawTransaction': {
        const raw = params[0] as Hex
        rawTransactions.push(raw)
        return keccak256(raw)
      }
      case 'eth_getTransactionReceipt': {
        const raw = rawTransactions.find((entry) => keccak256(entry) === params[0])
        if (!raw) return null
        const transaction = parseTransaction(raw)
        return {
          transactionHash: params[0], transactionIndex: '0x0', blockHash: `0x${'b'.repeat(64)}`, blockNumber: '0x11',
          from: `0x${'0'.repeat(40)}`, to: transaction.to ?? null, cumulativeGasUsed: '0x5208', gasUsed: '0x5208',
          effectiveGasPrice: '0x77359400', contractAddress: null, logs: [], logsBloom: `0x${'0'.repeat(512)}`,
          status: '0x1', type: '0x2'
        }
      }
      default: throw Object.assign(new Error(`Method ${method} is not available`), { code: -32601 })
    }
  }
  const server = createServer((request, response) => {
    let body = ''
    request.on('data', (chunk: Buffer) => { body += chunk.toString() })
    request.on('end', () => {
      const call = JSON.parse(body) as { id: number; method: string; params?: unknown[] }
      methods.push(call.method)
      let reply: Record<string, unknown>
      try {
        reply = { result: answer(call.method, call.params ?? []) }
      } catch (error) {
        reply = { error: { code: (error as { code: number }).code, message: (error as Error).message } }
      }
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ jsonrpc: '2.0', id: call.id, ...reply }))
    })
  })
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    resolve({ server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, methods, rawTransactions })
  }))
}

test('runs a dApp wallet flow end to end: connect, read, send, approve, confirm, with an agent watching', async ({ capabilities, appWindow, electronApp }) => {
  const { client, workspace, tabId, fixtureUrl, fixtureOrigin } = capabilities
  const chain = await startLocalChain()
  try {
    const vaultStatus = await appWindow.evaluate('window.hronautWallets.status()') as { managedWallets: string }
    if (vaultStatus.managedWallets === 'passphrase-setup-required') {
      await appWindow.evaluate(`window.hronautWallets.setupPassphrase('wallet dapp flow integration passphrase')`)
    }
    const prepared = await appWindow.evaluate(`window.hronautWallets.prepareImport(
      'evm',
      'private-key',
      '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
    )`) as { token: string; publicAddress: string }
    await appWindow.evaluate(`window.hronautWallets.confirmImport(${JSON.stringify(prepared.token)}, {
      name: 'dApp flow wallet',
      network: { id: '31337', name: 'Local chain', environment: 'local', rpcUrl: ${JSON.stringify(chain.url)} },
      workspaceIds: [${JSON.stringify(workspace.workspaceId)}],
      dedicatedAgent: false
    })`)

    const listed = await client.callTool({ name: 'wallet_list', arguments: { tabId, agentName: 'dApp flow agent' } }) as CallToolResult
    expect(listed.isError, text(listed)).not.toBe(true)
    const { walletSessionId } = JSON.parse(text(listed)) as { walletSessionId: string }
    const pageRequests = async () => {
      const result = await client.callTool({ name: 'wallet_page_requests', arguments: { tabId, walletSessionId } }) as CallToolResult
      expect(result.isError, text(result)).not.toBe(true)
      return JSON.parse(text(result)) as PageRequestList
    }
    const pageState = () => electronApp.evaluate(({ webContents }, pageUrl) => (
      webContents.getAllWebContents().find((contents) => contents.getURL() === pageUrl)?.executeJavaScript('window.__dappFlow')
    ), fixtureUrl) as Promise<Record<string, unknown>>
    const approveInHronaut = async (dialogName: RegExp) => {
      const approval = appWindow.getByRole('alertdialog', { name: dialogName })
      await expect(approval).toBeVisible()
      await approval.getByRole('button', { name: 'Approve exact request' }).click()
    }

    // The page behaves like a small wagmi/ethers dApp: discover via EIP-6963, connect, read, then send.
    await electronApp.evaluate(async ({ webContents }, pageUrl) => {
      const page = webContents.getAllWebContents().find((contents) => contents.getURL() === pageUrl)
      if (!page) throw new Error('dApp flow fixture WebContents was not found')
      await page.executeJavaScript(`
        window.__dappFlow = { phase: 'discovering' };
        window.addEventListener('eip6963:announceProvider', async (event) => {
          if (window.__dappFlow.phase !== 'discovering' || event.detail?.info?.rdns !== 'dev.hronaut.wallet') return;
          const provider = event.detail.provider;
          const flow = window.__dappFlow;
          try {
            flow.phase = 'connecting';
            const [account] = await provider.request({ method: 'eth_requestAccounts' });
            flow.account = account;
            flow.chainId = await provider.request({ method: 'eth_chainId' });
            flow.balance = await provider.request({ method: 'eth_getBalance', params: [account, 'latest'] });
            flow.blockNumber = await provider.request({ method: 'eth_blockNumber' });
            flow.phase = 'sending';
            flow.hash = await provider.request({
              method: 'eth_sendTransaction',
              params: [{ from: account, to: '0x1000000000000000000000000000000000000001', value: '0x1' }]
            });
            flow.phase = 'waiting-receipt';
            for (let attempt = 0; attempt < 50 && !flow.receiptStatus; attempt += 1) {
              const receipt = await provider.request({ method: 'eth_getTransactionReceipt', params: [flow.hash] });
              if (receipt) flow.receiptStatus = receipt.status;
              else await new Promise((resolve) => setTimeout(resolve, 100));
            }
            flow.phase = 'done';
          } catch (error) {
            flow.phase = 'failed';
            flow.error = { code: error?.code, message: String(error?.message) };
          }
        });
        window.dispatchEvent(new Event('eip6963:requestProvider'));
      `)
    }, fixtureUrl)

    await expect.poll(async () => (await pageRequests()).requests.map(({ operation, status }) => [operation, status]))
      .toEqual([['connect-account', 'awaiting-human']])
    await approveInHronaut(/Connect account/i)

    await expect.poll(async () => (await pageState()).phase).toBe('sending')
    await expect.poll(async () => (await pageRequests()).requests.map(({ operation, status }) => [operation, status]))
      .toEqual([['connect-account', 'confirmed'], ['sign-and-send-transaction', 'awaiting-human']])
    expect(chain.rawTransactions).toEqual([])
    await approveInHronaut(/send transaction/i)

    await expect.poll(async () => (await pageState()).phase, { timeout: 20_000 }).toBe('done')
    const flow = await pageState()
    expect(flow).toMatchObject({
      account: prepared.publicAddress,
      chainId: '0x7a69',
      balance: '0xde0b6b3a7640000',
      blockNumber: '0x10',
      receiptStatus: '0x1'
    })
    expect(chain.rawTransactions).toHaveLength(1)
    const sent = parseTransaction(chain.rawTransactions[0]!)
    expect(sent).toMatchObject({ chainId: 31337, to: '0x1000000000000000000000000000000000000001', value: 1n })
    expect(flow.hash).toBe(keccak256(chain.rawTransactions[0]!))

    await expect.poll(async () => (await pageRequests()).requests.find(({ operation }) => operation === 'sign-and-send-transaction'), { timeout: 20_000 })
      .toMatchObject({ status: 'confirmed', transactionHash: flow.hash })
    expect((await pageRequests()).origin).toBe(fixtureOrigin)
  } finally {
    chain.server.close()
  }
})
