import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { BrowserState } from '../../src/shared/types.js'
import { closeFixtureServer, expect, test } from './fixtures.js'

test('persists cancellation of a waiting wallet approval before the application exits', async ({ appWindow, electronApp, profileDirectory }) => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end('<!doctype html><title>Wallet shutdown fixture</title>')
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  try {
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Fixture port is unavailable')
    const url = `http://127.0.0.1:${address.port}/`
    const state = await appWindow.evaluate(`window.hronaut.newTab({ url: ${JSON.stringify(url)}, active: true })`) as BrowserState
    const workspaceId = state.tabs.find(tab => tab.url === url)?.mcpGroupId
    expect(workspaceId).toBeTruthy()
    await expect.poll(() => appWindow.evaluate('window.hronaut.getState().then(state => state.tabs.find(tab => tab.active)?.title)'))
      .toBe('Wallet shutdown fixture')
    const status = await appWindow.evaluate('window.hronautWallets.status()') as { managedWallets: string }
    if (status.managedWallets === 'passphrase-setup-required') {
      await appWindow.evaluate("window.hronautWallets.setupPassphrase('disposable shutdown fixture passphrase')")
    }
    // Synthetic, unfunded key. This test requests account access only.
    const prepared = await appWindow.evaluate("window.hronautWallets.prepareImport('evm', 'private-key', '0x' + '1'.repeat(64))") as { token: string }
    await appWindow.evaluate(`window.hronautWallets.confirmImport(${JSON.stringify(prepared.token)}, {
      name: 'Shutdown fixture wallet',
      network: { id: '31337', name: 'Local', environment: 'local', rpcUrl: 'http://127.0.0.1:8545' },
      workspaceIds: [${JSON.stringify(workspaceId)}], dedicatedAgent: false
    })`)
    await electronApp.evaluate(async ({ webContents }, url) => {
      const page = webContents.getAllWebContents().find(contents => contents.getURL() === url)
      if (!page) throw new Error('Wallet page is unavailable')
      await page.executeJavaScript(`
        void window.hronautEthereum.request({ method: 'eth_requestAccounts' }).catch(() => undefined);
        'requested';
      `)
    }, url)
    await expect(appWindow.getByRole('alertdialog', { name: /Connect account/i })).toBeVisible()
    const requests = await appWindow.evaluate('window.hronautWallets.listRequests()') as { id: string; status: string }[]
    const waiting = requests.find(request => request.status === 'awaiting-human')
    expect(waiting).toBeDefined()
    const exited = new Promise<number | null>(resolve => electronApp.process().once('exit', resolve))
    await appWindow.evaluate('setTimeout(() => window.hronaut.quit(), 0)')
    await expect(exited).resolves.toBe(0)
    const saved = JSON.parse(await readFile(join(profileDirectory, 'wallet', 'requests.json'), 'utf8')) as {
      requests: { id: string; status: string }[]
    }
    expect(saved.requests.find(request => request.id === waiting!.id)?.status).toBe('cancelled')
  } finally {
    await closeFixtureServer(server)
  }
})
