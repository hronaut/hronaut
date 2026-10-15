import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { expect, test } from './capability-fixtures.js'

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
