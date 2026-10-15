import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { expect, test } from './capability-fixtures.js'

function startJsonRpc(chainId: string): Promise<{ server: Server; url: string }> {
  const server = createServer((request, response) => {
    let body = ''
    request.on('data', (chunk: Buffer) => { body += chunk.toString() })
    request.on('end', () => {
      const call = JSON.parse(body) as { id: number; method: string }
      const reply = call.method === 'eth_chainId' ? { result: chainId } : { error: { code: -32601, message: 'Method not found' } }
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ jsonrpc: '2.0', id: call.id, ...reply }))
    })
  })
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    resolve({ server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}` })
  }))
}

test('keeps a dApp\'s pending wallet approval and network across its own route changes', async ({ capabilities, appWindow, electronApp }) => {
  const { workspace, fixtureOrigin } = capabilities
  const local = await startJsonRpc('0x7a69')
  const sepolia = await startJsonRpc('0xaa36a7')
  try {
    const vaultStatus = await appWindow.evaluate('window.hronautWallets.status()') as { managedWallets: string }
    if (vaultStatus.managedWallets === 'passphrase-setup-required') {
      await appWindow.evaluate(`window.hronautWallets.setupPassphrase('wallet spa navigation integration passphrase')`)
    }
    // Anvil's first two development keys, one on each network.
    for (const [key, network] of [
      ['0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80', { id: '31337', name: 'Local', environment: 'local', rpcUrl: local.url }],
      ['0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d', { id: '11155111', name: 'Sepolia', environment: 'testnet', rpcUrl: sepolia.url }]
    ] as const) {
      const prepared = await appWindow.evaluate(`window.hronautWallets.prepareImport('evm', 'private-key', ${JSON.stringify(key)})`) as { token: string }
      await appWindow.evaluate(`window.hronautWallets.confirmImport(${JSON.stringify(prepared.token)}, {
        name: ${JSON.stringify(network.name)}, network: ${JSON.stringify(network)},
        workspaceIds: [${JSON.stringify(workspace.workspaceId)}], dedicatedAgent: false
      })`)
    }
    // Runs a script in the fixture page, whatever its current path, and returns its value or error.
    const page = (script: string) => electronApp.evaluate(async ({ webContents }, { origin, source }) => {
      const contents = webContents.getAllWebContents().find((entry) => entry.getURL().startsWith(`${origin}/`))
      if (!contents) throw new Error('Wallet SPA navigation fixture WebContents was not found')
      return contents.executeJavaScript(`(async () => {
        try { return await (${source}) } catch (error) { return { code: error && error.code, message: String(error && error.message) } }
      })()`)
    }, { origin: fixtureOrigin, source: script })
    const pageUrl = () => electronApp.evaluate(({ webContents }, origin) => (
      webContents.getAllWebContents().find((entry) => entry.getURL().startsWith(`${origin}/`))?.getURL()
    ), fixtureOrigin)
    // A route change as a client-side router makes it, settled in the main process and followed by a wallet round trip.
    const route = async (script: string, path: string) => {
      await page(`(${script}, 'routed')`)
      await expect.poll(pageUrl).toContain(path)
      await page(`window.ethereum.request({ method: 'eth_chainId' })`)
    }
    const statuses = async () => (await appWindow.evaluate('window.hronautWallets.listRequests()') as Array<{ status: string }>)
      .map((request) => request.status)

    expect(await page(`window.ethereum.request({ method: 'eth_chainId' })`)).toBe('0x7a69')
    expect(await page(`window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0xaa36a7' }] })`)).toBeNull()
    await route(`history.pushState({}, '', '/swap')`, '/swap')
    await route(`location.hash = 'settings'`, '#settings')
    // The page stays on the network it chose.
    expect(await page(`window.ethereum.request({ method: 'eth_chainId' })`)).toBe('0xaa36a7')

    await page(`(window.walletSpaConnection = window.ethereum.request({ method: 'eth_requestAccounts' })
      .then((accounts) => ({ accounts: accounts.length }), (error) => ({ code: error.code })), 'requested')`)
    await expect.poll(statuses).toEqual(['awaiting-human'])
    await route(`history.replaceState({}, '', '/swap?from=ETH')`, '?from=ETH')
    // The approval the page is waiting on survives its route change.
    expect(await statuses()).toEqual(['awaiting-human'])
    expect(await page(`Promise.race([window.walletSpaConnection, Promise.resolve('waiting')])`)).toBe('waiting')

    // Loading another document still cancels it.
    await page(`(location.reload(), 'reloading')`)
    await expect.poll(statuses).toEqual(['cancelled'])
  } finally {
    local.server.close()
    sepolia.server.close()
  }
})
