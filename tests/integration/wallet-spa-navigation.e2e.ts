import type { ElectronApplication, Page } from '@playwright/test'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { expect, test, text } from './capability-fixtures.js'

type Network = { id: string; name: string; environment: 'local' | 'testnet'; rpcUrl: string }

// Anvil's first two development keys. Nothing here reaches a node: chain IDs, network switches and
// connection requests are answered by Hronaut itself.
const LOCAL: [string, Network] = ['0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80', { id: '31337', name: 'Local', environment: 'local', rpcUrl: 'http://127.0.0.1:8545' }]
const SEPOLIA: [string, Network] = ['0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d', { id: '11155111', name: 'Sepolia', environment: 'testnet', rpcUrl: 'http://127.0.0.1:8546' }]

async function importWallets(appWindow: Page, workspaceId: string, wallets: Array<[string, Network]>): Promise<void> {
  const vaultStatus = await appWindow.evaluate('window.hronautWallets.status()') as { managedWallets: string }
  if (vaultStatus.managedWallets === 'passphrase-setup-required') {
    await appWindow.evaluate(`window.hronautWallets.setupPassphrase('wallet spa navigation integration passphrase')`)
  }
  for (const [key, network] of wallets) {
    const prepared = await appWindow.evaluate(`window.hronautWallets.prepareImport('evm', 'private-key', ${JSON.stringify(key)})`) as { token: string }
    await appWindow.evaluate(`window.hronautWallets.confirmImport(${JSON.stringify(prepared.token)}, {
      name: ${JSON.stringify(network.name)}, network: ${JSON.stringify(network)},
      workspaceIds: [${JSON.stringify(workspaceId)}], dedicatedAgent: false
    })`)
  }
}

/** Runs a script in the fixture page, whatever its current path, and returns its value or error. */
function pageScript(electronApp: ElectronApplication, origin: string) {
  return (source: string) => electronApp.evaluate(async ({ webContents }, { origin, source }) => {
    const contents = webContents.getAllWebContents().find((entry) => entry.getURL().startsWith(`${origin}/`))
    if (!contents) throw new Error('Wallet SPA navigation fixture WebContents was not found')
    return contents.executeJavaScript(`(async () => {
      try { return await (${source}) } catch (error) { return { code: error && error.code, message: String(error && error.message) } }
    })()`)
  }, { origin, source })
}

/** A route change as a client-side router makes it, settled in the main process and followed by a wallet round trip. */
function routeChange(electronApp: ElectronApplication, origin: string) {
  const page = pageScript(electronApp, origin)
  const pageUrl = () => electronApp.evaluate(({ webContents }, origin) => (
    webContents.getAllWebContents().find((entry) => entry.getURL().startsWith(`${origin}/`))?.getURL()
  ), origin)
  return async (script: string, path: string) => {
    await page(`(${script}, 'routed')`)
    await expect.poll(pageUrl).toContain(path)
    await page(`window.ethereum.request({ method: 'eth_chainId' })`)
  }
}

test('keeps the network a dApp switched to across its own route changes', async ({ capabilities, appWindow, electronApp }) => {
  const { workspace, fixtureOrigin } = capabilities
  await importWallets(appWindow, workspace.workspaceId, [LOCAL, SEPOLIA])
  const page = pageScript(electronApp, fixtureOrigin)
  const route = routeChange(electronApp, fixtureOrigin)

  expect(await page(`window.ethereum.request({ method: 'eth_chainId' })`)).toBe('0x7a69')
  expect(await page(`window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0xaa36a7' }] })`)).toBeNull()
  await route(`history.pushState({}, '', '/swap')`, '/swap')
  await route(`location.hash = 'settings'`, '#settings')
  expect(await page(`window.ethereum.request({ method: 'eth_chainId' })`)).toBe('0xaa36a7')
})

test('keeps a dApp\'s pending wallet approval across its own route change, for the page and its agent', async ({ capabilities, appWindow, electronApp }) => {
  const { client, workspace, tabId, fixtureOrigin } = capabilities
  await importWallets(appWindow, workspace.workspaceId, [LOCAL])
  const page = pageScript(electronApp, fixtureOrigin)
  const route = routeChange(electronApp, fixtureOrigin)
  const listed = await client.callTool({ name: 'wallet_list', arguments: { tabId, agentName: 'dApp QA agent' } }) as CallToolResult
  expect(listed.isError, text(listed)).not.toBe(true)
  const { walletSessionId } = JSON.parse(text(listed)) as { walletSessionId: string }
  const agentStatuses = async () => {
    const result = await client.callTool({ name: 'wallet_page_requests', arguments: { tabId, walletSessionId } }) as CallToolResult
    expect(result.isError, text(result)).not.toBe(true)
    return (JSON.parse(text(result)) as { requests: Array<{ status: string }> }).requests.map(({ status }) => status)
  }
  const statuses = async () => (await appWindow.evaluate('window.hronautWallets.listRequests()') as Array<{ status: string }>)
    .map((request) => request.status)

  await page(`(window.walletSpaConnection = window.ethereum.request({ method: 'eth_requestAccounts' })
    .then((accounts) => ({ accounts: accounts.length }), (error) => ({ code: error.code })), 'requested')`)
  await expect.poll(statuses).toEqual(['awaiting-human'])
  await route(`history.replaceState({}, '', '/swap?from=ETH')`, '?from=ETH')
  expect(await statuses()).toEqual(['awaiting-human'])
  expect(await page(`Promise.race([window.walletSpaConnection, Promise.resolve('waiting')])`)).toBe('waiting')
  // The agent that opened its wallet session before the route change still sees the request.
  expect(await agentStatuses()).toEqual(['awaiting-human'])

  // Loading another document still cancels it.
  await electronApp.evaluate(({ webContents }, origin) => {
    webContents.getAllWebContents().find((entry) => entry.getURL().startsWith(`${origin}/`))?.reload()
  }, fixtureOrigin)
  await expect.poll(statuses).toEqual(['cancelled'])
})

test('keeps a dApp\'s pending wallet approval and network when a link starts a download or gets no content', async ({ capabilities, appWindow, electronApp }) => {
  const { client, workspace, fixtureUrl, fixtureOrigin, counters } = capabilities
  await importWallets(appWindow, workspace.workspaceId, [LOCAL, SEPOLIA])
  const page = pageScript(electronApp, fixtureOrigin)
  const statuses = async () => (await appWindow.evaluate('window.hronautWallets.listRequests()') as Array<{ status: string }>)
    .map((request) => request.status)
  const settled = () => electronApp.evaluate(({ webContents }, origin) => {
    const contents = webContents.getAllWebContents().find((entry) => entry.getURL().startsWith(`${origin}/`))
    return contents ? { loading: contents.isLoading(), url: contents.getURL() } : null
  }, fixtureOrigin)

  expect(await page(`window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0xaa36a7' }] })`)).toBeNull()
  await page(`(window.walletDownloadConnection = window.ethereum.request({ method: 'eth_requestAccounts' })
    .then((accounts) => ({ accounts: accounts.length }), (error) => ({ code: error.code })), 'requested')`)
  await expect.poll(statuses).toEqual(['awaiting-human'])

  // A navigation that the server answers with a file to save never replaces the page.
  await page(`(location.assign('/download'), 'navigating')`)
  await expect.poll(async () => {
    const result = await client.callTool({ name: 'browser_downloads', arguments: {} }) as CallToolResult
    return (JSON.parse(text(result)) as Array<{ state: string }>).map(({ state }) => state)
  }).toEqual(['completed'])
  await expect.poll(settled).toEqual({ loading: false, url: fixtureUrl })
  // Nor does one the server answers with no content.
  await page(`(location.assign('/memory-saver-tick'), 'navigating')`)
  await expect.poll(() => counters.memorySaverTicks).toBe(1)
  await expect.poll(settled).toEqual({ loading: false, url: fixtureUrl })

  expect(await statuses()).toEqual(['awaiting-human'])
  expect(await page(`Promise.race([window.walletDownloadConnection, Promise.resolve('waiting')])`)).toBe('waiting')
  expect(await page(`window.ethereum.request({ method: 'eth_chainId' })`)).toBe('0xaa36a7')

  // Loading another document still cancels it, and the next page starts on the default network.
  await page(`(location.assign('/no-js'), 'navigating')`)
  await expect.poll(statuses).toEqual(['cancelled'])
  await expect.poll(settled).toEqual({ loading: false, url: `${fixtureOrigin}/no-js` })
  expect(await page(`window.ethereum.request({ method: 'eth_chainId' })`)).toBe('0x7a69')
})
