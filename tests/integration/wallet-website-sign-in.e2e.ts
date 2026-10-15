import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
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
async function signInWallet(appWindow: Page, workspaceId: string, origin: string): Promise<{ publicAddress: string }> {
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
    dedicatedAgent: false
  })`) as { id: string }
  await appWindow.evaluate(`window.hronautWallets.setPolicy(${JSON.stringify({
    id: 'website-sign-in', name: 'Fixture sign-in', mode: 'bounded-auto', walletId: imported.id,
    workspaceId, networkIds: ['31337'], origins: [origin], destinations: [], methods: [],
    expiresAt: new Date(Date.now() + 60 * 60_000).toISOString(), maximumOperationCount: 5,
    requireSuccessfulSimulation: true, allowMessageSigning: false, allowWebsiteSignIn: true
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
  await appWindow.evaluate(`window.hronautWallets.rejectRequest(${JSON.stringify(typed.id)})`)
  await expect.poll(() => page('window.__walletTyped')).toBe('rejected:4001')
})

test('lets an agent sign in on the local wallet QA fixture without a click', async ({ capabilities, appWindow, electronApp }) => {
  const { client, workspace, tabId } = capabilities
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
    response.end(readFileSync('examples/wallet-qa/index.html'))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
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
