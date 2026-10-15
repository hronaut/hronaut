import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { expect, test, text } from './capability-fixtures.js'

interface PageRequestList {
  origin: string
  requests: Array<{ id: string; operation: string; status: string; requester: { type: string }; details?: Record<string, unknown> }>
  failedCalls?: Array<{ family: string; method: string; error: string; failedAt: string }>
}

test('lets an agent read the wallet requests a dApp page made, without approving them', async ({ capabilities, appWindow, electronApp }) => {
  const { client, workspace, tabId, fixtureUrl, fixtureOrigin } = capabilities
  const vaultStatus = await appWindow.evaluate('window.hronautWallets.status()') as { managedWallets: string }
  if (vaultStatus.managedWallets === 'passphrase-setup-required') {
    await appWindow.evaluate(`window.hronautWallets.setupPassphrase('wallet page requests integration passphrase')`)
  }
  const prepared = await appWindow.evaluate(`window.hronautWallets.prepareImport(
    'evm',
    'private-key',
    '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
  )`) as { token: string; publicAddress: string }
  await appWindow.evaluate(`window.hronautWallets.confirmImport(${JSON.stringify(prepared.token)}, {
    name: 'Page requests wallet',
    network: { id: '31337', name: 'Anvil', environment: 'local', rpcUrl: 'http://127.0.0.1:8545' },
    workspaceIds: [${JSON.stringify(workspace.workspaceId)}],
    dedicatedAgent: false
  })`)

  const listed = await client.callTool({ name: 'wallet_list', arguments: { tabId, agentName: 'dApp QA agent' } }) as CallToolResult
  expect(listed.isError, text(listed)).not.toBe(true)
  const { walletSessionId } = JSON.parse(text(listed)) as { walletSessionId: string }
  const readPageRequests = async () => {
    const result = await client.callTool({ name: 'wallet_page_requests', arguments: { tabId, walletSessionId } }) as CallToolResult
    expect(result.isError, text(result)).not.toBe(true)
    return JSON.parse(text(result)) as PageRequestList
  }
  expect(await readPageRequests()).toEqual({ origin: fixtureOrigin, requests: [] })

  // A dApp that calls a method Hronaut does not support gets code 4200, and the agent sees why its button did nothing.
  const unsupported = await electronApp.evaluate(({ webContents }, pageUrl) => (
    webContents.getAllWebContents().find((contents) => contents.getURL() === pageUrl)?.executeJavaScript(
      `window.ethereum.request({ method: 'eth_signTypedData_v3', params: ['0x0', 'page-secret-typed-data'] }).then(() => 'resolved', (error) => error.code)`
    )
  ), fixtureUrl)
  expect(unsupported).toBe(4200)
  const afterUnsupported = await readPageRequests()
  expect(afterUnsupported).toEqual({
    origin: fixtureOrigin,
    requests: [],
    failedCalls: [{ family: 'evm', method: 'eth_signTypedData_v3', error: 'Unsupported EVM wallet method: eth_signTypedData_v3', failedAt: expect.any(String) }]
  })
  expect(JSON.stringify(afterUnsupported)).not.toContain('page-secret-typed-data')

  await electronApp.evaluate(async ({ webContents }, pageUrl) => {
    const page = webContents.getAllWebContents().find((contents) => contents.getURL() === pageUrl)
    if (!page) throw new Error('Wallet page requests fixture WebContents was not found')
    await page.executeJavaScript(`
      window.__walletConnect = 'waiting-provider';
      window.addEventListener('eip6963:announceProvider', (event) => {
        if (window.__walletConnect !== 'waiting-provider' || event.detail?.info?.rdns !== 'dev.hronaut.wallet') return;
        window.__walletConnect = 'pending';
        event.detail.provider.request({ method: 'eth_requestAccounts' }).then(
          (accounts) => { window.__walletConnect = 'connected:' + accounts.length },
          (error) => { window.__walletConnect = 'rejected:' + (error?.code ?? 'unknown') }
        );
      });
      window.dispatchEvent(new Event('eip6963:requestProvider'));
    `)
  }, fixtureUrl)

  await expect.poll(async () => (await readPageRequests()).requests.map(({ operation, status, requester }) => [operation, status, requester.type]))
    .toEqual([['connect-account', 'awaiting-human', 'website']])
  const pending = (await readPageRequests()).requests[0]!
  expect(JSON.stringify(pending)).not.toContain(prepared.publicAddress)
  expect(JSON.stringify(pending)).not.toContain(prepared.publicAddress.toLowerCase())

  const catalog = await client.listTools()
  expect(catalog.tools.some(({ name }) => /approve/i.test(name))).toBe(false)

  await appWindow.evaluate(`window.hronautWallets.approveRequest(${JSON.stringify(pending.id)})`)
  await expect.poll(async () => (await readPageRequests()).requests.map(({ status }) => status)).toEqual(['confirmed'])
  await expect.poll(() => electronApp.evaluate(({ webContents }, pageUrl) => (
    webContents.getAllWebContents().find((contents) => contents.getURL() === pageUrl)?.executeJavaScript('window.__walletConnect')
  ), fixtureUrl)).toBe('connected:1')
})
