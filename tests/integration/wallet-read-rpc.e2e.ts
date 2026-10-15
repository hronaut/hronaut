import { readFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { expect, test } from './capability-fixtures.js'

const TOKEN = '0x5FbDB2315678afecb367f032d93F642f64180aa3'
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
const RECIPIENT = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'

function startFilterJsonRpc(sender: string): Promise<{ server: Server; url: string; calls: Array<{ method: string; params: unknown[] }> }> {
  const calls: Array<{ method: string; params: unknown[] }> = []
  let block = 0x2a
  let delivered = false
  const topic = (address: string) => `0x${address.slice(2).toLowerCase().padStart(64, '0')}`
  const server = createServer((request, response) => {
    let body = ''
    request.on('data', (chunk: Buffer) => { body += chunk.toString() })
    request.on('end', () => {
      const call = JSON.parse(body) as { id: number; method: string; params?: unknown[] }
      calls.push({ method: call.method, params: call.params ?? [] })
      let result: unknown
      if (call.method === 'eth_blockNumber') result = `0x${(block++).toString(16)}`
      else if (call.method === 'eth_newFilter') result = '0x1'
      else if (call.method === 'eth_uninstallFilter') result = true
      else if (call.method === 'eth_getFilterChanges') {
        result = delivered ? [] : [{
          address: TOKEN.toLowerCase(), topics: [TRANSFER_TOPIC, topic(sender), topic(RECIPIENT)],
          data: `0x${(1000n).toString(16).padStart(64, '0')}`, blockNumber: '0x2b', blockHash: `0x${'ab'.repeat(32)}`,
          transactionHash: `0x${'cd'.repeat(32)}`, transactionIndex: '0x0', logIndex: '0x0', removed: false
        }]
        delivered = true
      }
      const reply = result === undefined ? { error: { code: -32601, message: 'Method not found' } } : { result }
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ jsonrpc: '2.0', id: call.id, ...reply }))
    })
  })
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    resolve({ server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, calls })
  }))
}

function startJsonRpc(): Promise<{ server: Server; url: string; methods: string[] }> {
  const methods: string[] = []
  const server = createServer((request, response) => {
    let body = ''
    request.on('data', (chunk: Buffer) => { body += chunk.toString() })
    request.on('end', () => {
      const call = JSON.parse(body) as { id: number; method: string }
      methods.push(call.method)
      const reply = call.method === 'eth_blockNumber'
        ? { result: '0x2a' }
        : call.method === 'eth_getBalance'
          ? { result: '0xde0b6b3a7640000' }
          : call.method === 'eth_call'
            ? { error: { code: 3, message: 'execution reverted: Not owner', data: '0x08c379a0' } }
            : { error: { code: -32601, message: 'Method not found' } }
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ jsonrpc: '2.0', id: call.id, ...reply }))
    })
  })
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    resolve({ server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, methods })
  }))
}

test('lets a dApp page read chain state through the wallet provider without a connection prompt', async ({ capabilities, appWindow, electronApp }) => {
  const { workspace, fixtureUrl } = capabilities
  const rpc = await startJsonRpc()
  try {
    const vaultStatus = await appWindow.evaluate('window.hronautWallets.status()') as { managedWallets: string }
    if (vaultStatus.managedWallets === 'passphrase-setup-required') {
      await appWindow.evaluate(`window.hronautWallets.setupPassphrase('wallet read rpc integration passphrase')`)
    }
    const prepared = await appWindow.evaluate(`window.hronautWallets.prepareImport(
      'evm',
      'private-key',
      '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
    )`) as { token: string; publicAddress: string }
    await appWindow.evaluate(`window.hronautWallets.confirmImport(${JSON.stringify(prepared.token)}, {
      name: 'Read RPC wallet',
      network: { id: '31337', name: 'Local', environment: 'local', rpcUrl: ${JSON.stringify(rpc.url)} },
      workspaceIds: [${JSON.stringify(workspace.workspaceId)}],
      dedicatedAgent: false
    })`)

    const results = await electronApp.evaluate(async ({ webContents }, { pageUrl, address }) => {
      const page = webContents.getAllWebContents().find((contents) => contents.getURL() === pageUrl)
      if (!page) throw new Error('Wallet read RPC fixture WebContents was not found')
      return page.executeJavaScript(`(async () => {
        const provider = window.ethereum;
        const settle = (promise) => promise.then(
          (value) => ({ value }),
          (error) => ({ code: error.code, data: error.data, message: String(error.message) })
        );
        return {
          blockNumber: await settle(provider.request({ method: 'eth_blockNumber' })),
          balance: await settle(provider.request({ method: 'eth_getBalance', params: [${JSON.stringify(address)}, 'latest'] })),
          netVersion: await settle(provider.request({ method: 'net_version' })),
          revert: await settle(provider.request({ method: 'eth_call', params: [{ to: '0x0000000000000000000000000000000000000002', data: '0x' }, 'latest'] })),
          raw: await settle(provider.request({ method: 'eth_sendRawTransaction', params: ['0x00'] }))
        };
      })()`)
    }, { pageUrl: fixtureUrl, address: prepared.publicAddress })

    expect(results.blockNumber).toEqual({ value: '0x2a' })
    expect(results.balance).toEqual({ value: '0xde0b6b3a7640000' })
    expect(results.netVersion).toEqual({ value: '31337' })
    expect(results.revert).toMatchObject({ code: 3, data: '0x08c379a0' })
    expect(results.revert.message).toContain('execution reverted: Not owner')
    expect(results.revert.message).not.toContain(rpc.url)
    expect(results.raw).toMatchObject({ code: 4200 })
    expect(rpc.methods).toEqual(['eth_blockNumber', 'eth_getBalance', 'eth_call'])
    expect(await appWindow.evaluate('window.hronautWallets.listRequests()')).toEqual([])
  } finally {
    rpc.server.close()
  }
})

test('delivers an ethers v6 contract event listener through the wallet provider filters', async ({ capabilities, appWindow, electronApp }) => {
  const { workspace, fixtureUrl } = capabilities
  const sender = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'
  const rpc = await startFilterJsonRpc(sender)
  try {
    const vaultStatus = await appWindow.evaluate('window.hronautWallets.status()') as { managedWallets: string }
    if (vaultStatus.managedWallets === 'passphrase-setup-required') {
      await appWindow.evaluate(`window.hronautWallets.setupPassphrase('wallet filter rpc integration passphrase')`)
    }
    const prepared = await appWindow.evaluate(`window.hronautWallets.prepareImport(
      'evm',
      'private-key',
      '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
    )`) as { token: string; publicAddress: string }
    await appWindow.evaluate(`window.hronautWallets.confirmImport(${JSON.stringify(prepared.token)}, {
      name: 'Filter RPC wallet',
      network: { id: '31337', name: 'Local', environment: 'local', rpcUrl: ${JSON.stringify(rpc.url)} },
      workspaceIds: [${JSON.stringify(workspace.workspaceId)}],
      dedicatedAgent: false
    })`)
    // ethers is installed with tronweb; its browser bundle stands in for a dApp's own copy.
    const ethersBundle = readFileSync(new URL('../../node_modules/ethers/dist/ethers.umd.min.js', import.meta.url), 'utf8')

    const results = await electronApp.evaluate(async ({ webContents }, { pageUrl, bundle, token }) => {
      const page = webContents.getAllWebContents().find((contents) => contents.getURL() === pageUrl)
      if (!page) throw new Error('Wallet filter RPC fixture WebContents was not found')
      await page.executeJavaScript(bundle)
      return page.executeJavaScript(`(async () => {
        const provider = new ethers.BrowserProvider(window.ethereum, undefined, { pollingInterval: 100 });
        const contract = new ethers.Contract(${JSON.stringify(token)}, ['event Transfer(address indexed from, address indexed to, uint256 value)'], provider);
        const transfer = await new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('The Transfer listener did not fire')), 15000);
          contract.on('Transfer', (from, to, value) => {
            clearTimeout(timer);
            resolve({ from, to, value: value.toString() });
          });
        });
        await contract.removeAllListeners();
        const foreign = await window.ethereum.request({ method: 'eth_getFilterChanges', params: ['0x7'] })
          .then((value) => ({ value }), (error) => ({ code: error.code, message: String(error.message) }));
        return { transfer, foreign };
      })()`)
    }, { pageUrl: fixtureUrl, bundle: ethersBundle, token: TOKEN })

    expect(results.transfer).toEqual({ from: sender, to: RECIPIENT, value: '1000' })
    // A filter this page did not create never reaches the node.
    expect(results.foreign).toMatchObject({ code: -32000 })
    expect(results.foreign.message).toContain('filter not found')
    const newFilter = rpc.calls.find((call) => call.method === 'eth_newFilter')
    expect(newFilter?.params[0]).toMatchObject({ address: [TOKEN.toLowerCase()], topics: [TRANSFER_TOPIC] })
    expect(rpc.calls.filter((call) => call.method === 'eth_getFilterChanges').every((call) => call.params[0] === '0x1')).toBe(true)
    await expect.poll(() => rpc.calls.some((call) => call.method === 'eth_uninstallFilter' && call.params[0] === '0x1')).toBe(true)
    expect(await appWindow.evaluate('window.hronautWallets.listRequests()')).toEqual([])
  } finally {
    rpc.server.close()
  }
})
