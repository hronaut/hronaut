import { readFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { ElectronApplication, Page } from '@playwright/test'
import { closeFixtureServer } from './fixtures.js'
import { expect, test, text } from './capability-fixtures.js'

interface PageRequestList {
  origin: string
  requests: Array<{ id: string; operation: string; status: string }>
}

// Imports Anvil's public test key for one workspace with a sign-in only policy for one origin.
// With typedData, the key is a dedicated agent wallet whose policy also signs typed data.
async function signInWallet(appWindow: Page, workspaceId: string, origin: string, typedData = false): Promise<{ publicAddress: string }> {
  const vaultStatus = await appWindow.evaluate('window.hronautWallets.status()') as { managedWallets: string }
  if (vaultStatus.managedWallets === 'passphrase-setup-required') {
    await appWindow.evaluate(`window.hronautWallets.setupPassphrase('wallet website sign-in integration passphrase')`)
  }
  const prepared = await appWindow.evaluate(`window.hronautWallets.prepareImport(
    'evm',
    'private-key',
    '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
  )`) as { token: string; publicAddress: string }
  const imported = await appWindow.evaluate(`window.hronautWallets.confirmImport(${JSON.stringify(prepared.token)}, {
    name: 'Sign-in wallet',
    network: { id: '31337', name: 'Anvil', environment: 'local', rpcUrl: 'http://127.0.0.1:8545' },
    workspaceIds: [${JSON.stringify(workspaceId)}],
    dedicatedAgent: ${typedData}
  })`) as { id: string }
  await appWindow.evaluate(`window.hronautWallets.setPolicy(${JSON.stringify({
    id: 'website-sign-in', name: 'Fixture sign-in', mode: 'bounded-auto', walletId: imported.id,
    workspaceId, networkIds: ['31337'], origins: [origin], destinations: [], methods: [],
    expiresAt: new Date(Date.now() + 60 * 60_000).toISOString(), maximumOperationCount: 5,
    requireSuccessfulSimulation: true, allowMessageSigning: false, allowWebsiteSignIn: true,
    ...(typedData ? { allowWebsiteTypedData: true } : {})
  })})`)
  return { publicAddress: prepared.publicAddress }
}

async function pageRequestReader(client: Client, tabId: string): Promise<() => Promise<PageRequestList>> {
  const listed = await client.callTool({ name: 'wallet_list', arguments: { tabId, agentName: 'dApp QA agent' } }) as CallToolResult
  expect(listed.isError, text(listed)).not.toBe(true)
  const { walletSessionId } = JSON.parse(text(listed)) as { walletSessionId: string }
  return async () => {
    const result = await client.callTool({ name: 'wallet_page_requests', arguments: { tabId, walletSessionId } }) as CallToolResult
    expect(result.isError, text(result)).not.toBe(true)
    return JSON.parse(text(result)) as PageRequestList
  }
}

// Serves the checked-in wallet QA fixture on a loopback origin.
async function serveWalletQaFixture(): Promise<{ origin: string; server: Server }> {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
    response.end(readFileSync('examples/wallet-qa/index.html'))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  return { origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, server }
}

function pageScript(electronApp: ElectronApplication, pageUrl: string) {
  return (script: string) => electronApp.evaluate(({ webContents }, [url, source]) => {
    const contents = webContents.getAllWebContents().find((candidate) => candidate.getURL() === url)
    if (!contents) throw new Error('Wallet sign-in fixture WebContents was not found')
    return contents.executeJavaScript(source)
  }, [pageUrl, script] as const)
}

test('lets an opted-in local dApp connect and sign a plain-text sign-in message without a click', async ({ capabilities, appWindow, electronApp }) => {
  const { client, workspace, tabId, fixtureUrl, fixtureOrigin } = capabilities
  const prepared = await signInWallet(appWindow, workspace.workspaceId, fixtureOrigin)
  const readPageRequests = await pageRequestReader(client, tabId)
  const page = pageScript(electronApp, fixtureUrl)

  const host = new URL(fixtureOrigin).host
  const signIn = [
    `${host} wants you to sign in with your Ethereum account:`, prepared.publicAddress, '', 'Sign in to the fixture.', '',
    `URI: ${fixtureOrigin}`, 'Version: 1', 'Chain ID: 31337', 'Nonce: 32891756', `Issued At: ${new Date().toISOString()}`
  ].join('\n')
  await page(`
    window.__walletSignIn = 'waiting-provider';
    window.addEventListener('eip6963:announceProvider', async (event) => {
      if (window.__walletSignIn !== 'waiting-provider' || event.detail?.info?.rdns !== 'dev.hronaut.wallet') return;
      const provider = event.detail.provider;
      window.__walletProvider = provider;
      try {
        window.__walletSignIn = 'connecting';
        const [account] = await provider.request({ method: 'eth_requestAccounts' });
        window.__walletSignIn = 'signing';
        const signature = await provider.request({ method: 'personal_sign', params: [${JSON.stringify(signIn)}, account] });
        window.__walletSignIn = 'signed:' + account.toLowerCase() + ':' + signature.length;
      } catch (error) {
        window.__walletSignIn = 'failed:' + (error?.code ?? error?.message ?? 'unknown');
      }
    });
    window.dispatchEvent(new Event('eip6963:requestProvider'));
  `)

  // Nothing is approved by hand: the policy connects the account and signs the sign-in text.
  await expect.poll(() => page('window.__walletSignIn')).toBe(`signed:${prepared.publicAddress.toLowerCase()}:132`)
  expect((await readPageRequests()).requests.map(({ operation, status }) => [operation, status]).sort())
    .toEqual([['connect-account', 'confirmed'], ['sign-message', 'confirmed']])

  // Typed data stays with a person even under the sign-in policy.
  await page(`
    window.__walletTyped = 'pending';
    window.__walletProvider.request({ method: 'eth_signTypedData_v4', params: [${JSON.stringify(prepared.publicAddress)}, JSON.stringify({
      domain: { name: 'Fixture', chainId: 31337 }, primaryType: 'Login',
      types: { EIP712Domain: [{ name: 'name', type: 'string' }, { name: 'chainId', type: 'uint256' }], Login: [{ name: 'nonce', type: 'uint256' }] },
      message: { nonce: 1 }
    })] }).then(() => { window.__walletTyped = 'signed' }, (error) => { window.__walletTyped = 'rejected:' + (error?.code ?? 'unknown') });
    'started';
  `)
  await expect.poll(async () => (await readPageRequests()).requests.filter(({ status }) => status === 'awaiting-human').map(({ operation }) => operation))
    .toEqual(['sign-message'])
  const typed = (await readPageRequests()).requests.find(({ status }) => status === 'awaiting-human')!
  const typedSummary = appWindow.getByRole('region', { name: 'Typed data to sign' })
  await expect(typedSummary).toContainText('Login')
  await expect(typedSummary).toContainText('Fixture')
  await expect(typedSummary).toContainText('31337')
  await appWindow.evaluate(`window.hronautWallets.rejectRequest(${JSON.stringify(typed.id)})`)
  await expect.poll(() => page('window.__walletTyped')).toBe('rejected:4001')
})

test('lets an agent sign in on the local wallet QA fixture without a click', async ({ capabilities, appWindow, electronApp }) => {
  const { client, workspace, tabId } = capabilities
  const { origin, server } = await serveWalletQaFixture()
  try {
    const pageUrl = `${origin}/`
    const { publicAddress } = await signInWallet(appWindow, workspace.workspaceId, origin)
    const navigated = await client.callTool({ name: 'browser_navigate', arguments: { tabId, url: pageUrl } }) as CallToolResult
    expect(navigated.isError, text(navigated)).not.toBe(true)
    const readPageRequests = await pageRequestReader(client, tabId)
    const page = pageScript(electronApp, pageUrl)
    const fixtureLog = () => page(`document.querySelector('#log').textContent`) as Promise<string>

    await page(`document.querySelector('#connect').click(); 'clicked';`)
    await expect.poll(fixtureLog).toContain('"accountCount": 1')
    await page(`document.querySelector('#sign-in').click(); 'clicked';`)
    await expect.poll(fixtureLog).toContain('"signatureBytes": 65')

    expect((await readPageRequests()).requests.map(({ operation, status }) => [operation, status]).sort())
      .toEqual([['connect-account', 'confirmed'], ['sign-message', 'confirmed']])
    const log = await fixtureLog()
    expect(log).toContain('"signatureReturned": true')
    expect(log.toLowerCase()).not.toContain(publicAddress.toLowerCase())
    expect(log).not.toContain('wants you to sign in')
  } finally {
    await closeFixtureServer(server)
  }
})

test('shows the wallet QA fixture token permit to a person, who approves it', async ({ capabilities, appWindow, electronApp }) => {
  const { client, workspace, tabId } = capabilities
  const { origin, server } = await serveWalletQaFixture()
  try {
    const pageUrl = `${origin}/`
    const { publicAddress } = await signInWallet(appWindow, workspace.workspaceId, origin)
    const navigated = await client.callTool({ name: 'browser_navigate', arguments: { tabId, url: pageUrl } }) as CallToolResult
    expect(navigated.isError, text(navigated)).not.toBe(true)
    const readPageRequests = await pageRequestReader(client, tabId)
    const page = pageScript(electronApp, pageUrl)
    const fixtureLog = () => page(`document.querySelector('#log').textContent`) as Promise<string>

    await page(`document.querySelector('#connect').click(); 'clicked';`)
    await expect.poll(fixtureLog).toContain('"accountCount": 1')
    await page(`document.querySelector('#sign-permit').click(); 'clicked';`)

    // Without the typed-data switch, typed data goes to a person, who sees what the permit allows.
    const approval = appWindow.getByRole('alertdialog', { name: /sign message/i })
    await expect(approval).toBeVisible()
    const summary = approval.getByRole('region', { name: 'Typed data to sign' })
    await expect(summary).toContainText('Permit')
    await expect(summary).toContainText('Hronaut QA Token · version 1')
    await expect(summary).toContainText('31337')
    await expect(summary).toContainText('0x70997970C51812dc3A010C7d01b50e0d17dc79C8')
    await expect(summary).toContainText('0x5FbDB2315678afecb367f032d93F642f64180aa3 · 1000000 (smallest token units)')
    await expect(approval.getByRole('alert')).toHaveText([
      'Hronaut could not fully decode this request. Approval requires extra care.',
      'This is a token permit. Signing it lets the spender move your tokens without another approval from you.'
    ])
    await approval.getByRole('button', { name: 'Approve exact request' }).click()

    await expect.poll(fixtureLog).toContain('"signatureBytes": 65')
    expect((await readPageRequests()).requests.map(({ operation, status }) => [operation, status]).sort())
      .toEqual([['connect-account', 'confirmed'], ['sign-message', 'confirmed']])
    const log = await fixtureLog()
    expect(log).toContain('"typedData": "eip-2612-permit"')
    expect(log.toLowerCase()).not.toContain(publicAddress.toLowerCase())
  } finally {
    await closeFixtureServer(server)
  }
})

test('lets a dedicated agent wallet sign the wallet QA fixture token permit without a click under the typed-data switch', async ({ capabilities, appWindow, electronApp }) => {
  const { client, workspace, tabId } = capabilities
  const { origin, server } = await serveWalletQaFixture()
  try {
    const pageUrl = `${origin}/`
    await signInWallet(appWindow, workspace.workspaceId, origin, true)
    const navigated = await client.callTool({ name: 'browser_navigate', arguments: { tabId, url: pageUrl } }) as CallToolResult
    expect(navigated.isError, text(navigated)).not.toBe(true)
    const readPageRequests = await pageRequestReader(client, tabId)
    const page = pageScript(electronApp, pageUrl)
    const fixtureLog = () => page(`document.querySelector('#log').textContent`) as Promise<string>

    await page(`document.querySelector('#connect').click(); 'clicked';`)
    await expect.poll(fixtureLog).toContain('"accountCount": 1')
    await page(`document.querySelector('#sign-permit').click(); 'clicked';`)
    await expect.poll(fixtureLog).toContain('"signatureBytes": 65')

    await expect(appWindow.getByRole('alertdialog', { name: /sign message/i })).toHaveCount(0)
    expect((await readPageRequests()).requests.map(({ operation, status }) => [operation, status]).sort())
      .toEqual([['connect-account', 'confirmed'], ['sign-message', 'confirmed']])
    expect(await fixtureLog()).toContain('"typedData": "eip-2612-permit"')
  } finally {
    await closeFixtureServer(server)
  }
})

test('shows the sign-in text and a warning when a page asks to sign in for another site', async ({ capabilities, appWindow, electronApp }) => {
  const { workspace, fixtureUrl, fixtureOrigin } = capabilities
  const { publicAddress } = await signInWallet(appWindow, workspace.workspaceId, fixtureOrigin)
  const page = pageScript(electronApp, fixtureUrl)
  const signIn = [
    'phishing.example wants you to sign in with your Ethereum account:', publicAddress, '', 'Sign in to another site.', '',
    'URI: https://phishing.example', 'Version: 1', 'Chain ID: 31337', 'Nonce: 32891756', `Issued At: ${new Date().toISOString()}`
  ].join('\n')
  await page(`
    window.__otherSiteSignIn = 'waiting-provider';
    window.addEventListener('eip6963:announceProvider', async (event) => {
      if (window.__otherSiteSignIn !== 'waiting-provider' || event.detail?.info?.rdns !== 'dev.hronaut.wallet') return;
      const provider = event.detail.provider;
      try {
        window.__otherSiteSignIn = 'connecting';
        const [account] = await provider.request({ method: 'eth_requestAccounts' });
        window.__otherSiteSignIn = 'signing';
        await provider.request({ method: 'personal_sign', params: [${JSON.stringify(signIn)}, account] });
        window.__otherSiteSignIn = 'signed';
      } catch (error) {
        window.__otherSiteSignIn = 'failed:' + (error?.code ?? 'unknown');
      }
    });
    window.dispatchEvent(new Event('eip6963:requestProvider'));
    'started';
  `)

  // The policy connects the account, but a sign-in for another site goes to a person, who sees why.
  const approval = appWindow.getByRole('alertdialog', { name: /sign message/i })
  await expect(approval).toBeVisible()
  await expect(approval.getByRole('region', { name: 'Message to sign' })).toHaveText(signIn)
  await expect(approval.getByRole('alert')).toHaveText('This sign-in message names a different website than the one asking. Signing it could log someone in to that other site as you.')
  await approval.getByRole('button', { name: 'Reject' }).click()
  await expect.poll(() => page('window.__otherSiteSignIn')).toBe('failed:4001')
})
