import { createServer } from 'node:http'
import { closeFixtureServer, expect, test } from './fixtures.js'

test('wallet provider events preserve EventEmitter listener delivery semantics', async ({
  appWindow,
  electronApp
}) => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end('<!doctype html><title>Wallet provider events</title><main>Wallet provider events</main>')
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  try {
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Wallet provider event fixture did not expose a port')
    const url = `http://127.0.0.1:${address.port}/wallet-provider-events`
    await appWindow.evaluate(`window.hronaut.newTab({ url: ${JSON.stringify(url)}, active: true })`)
    await expect.poll(() => appWindow.evaluate('window.hronaut.getState().then((state) => state.tabs.find((entry) => entry.active)?.title)'))
      .toBe('Wallet provider events')

    await electronApp.evaluate(async ({ webContents }, requestedUrl) => {
      const page = webContents.getAllWebContents().find((contents) => contents.getURL() === requestedUrl)
      if (!page) throw new Error('Wallet provider event WebContents was not found')
      await page.executeJavaScript(`
        window.__walletEventCalls = [];
        window.__walletAddedListener = () => window.__walletEventCalls.push('added');
        window.__walletRemovedListener = () => window.__walletEventCalls.push('removed');
        window.__walletFirstListener = () => {
          window.__walletEventCalls.push('first');
          window.hronautEthereum.removeListener('accountsChanged', window.__walletRemovedListener);
          window.hronautEthereum.on('accountsChanged', window.__walletAddedListener);
        };
        window.hronautEthereum.on('accountsChanged', window.__walletFirstListener);
        window.hronautEthereum.on('accountsChanged', window.__walletRemovedListener);
        window.__walletDuplicateCalls = [];
        window.__walletDuplicateListener = (chainId) => window.__walletDuplicateCalls.push(chainId);
        window.hronautEthereum.on('chainChanged', window.__walletDuplicateListener);
        window.hronautEthereum.on('chainChanged', window.__walletDuplicateListener);
        'ready';
      `)
      page.send('wallet-provider:event', { family: 'evm', event: 'accountsChanged', payload: ['0x01'] })
      page.send('wallet-provider:event', { family: 'evm', event: 'chainChanged', payload: '0x1' })
    }, url)

    await expect.poll(() => electronApp.evaluate(async ({ webContents }, requestedUrl) => {
      const page = webContents.getAllWebContents().find((contents) => contents.getURL() === requestedUrl)
      return page?.executeJavaScript(`({
        eventCalls: window.__walletEventCalls,
        duplicateCalls: window.__walletDuplicateCalls
      })`)
    }, url)).toEqual({ eventCalls: ['first', 'removed'], duplicateCalls: ['0x1', '0x1'] })

    await electronApp.evaluate(async ({ webContents }, requestedUrl) => {
      const page = webContents.getAllWebContents().find((contents) => contents.getURL() === requestedUrl)
      if (!page) throw new Error('Wallet provider event WebContents was not found')
      await page.executeJavaScript(`
        window.hronautEthereum.removeListener('chainChanged', window.__walletDuplicateListener);
        'removed';
      `)
      page.send('wallet-provider:event', { family: 'evm', event: 'accountsChanged', payload: ['0x02'] })
      page.send('wallet-provider:event', { family: 'evm', event: 'chainChanged', payload: '0x2' })
    }, url)

    await expect.poll(() => electronApp.evaluate(async ({ webContents }, requestedUrl) => {
      const page = webContents.getAllWebContents().find((contents) => contents.getURL() === requestedUrl)
      return page?.executeJavaScript(`({
        eventCalls: window.__walletEventCalls,
        duplicateCalls: window.__walletDuplicateCalls
      })`)
    }, url)).toEqual({
      eventCalls: ['first', 'removed', 'first', 'added'],
      duplicateCalls: ['0x1', '0x1', '0x2']
    })
  } finally {
    await closeFixtureServer(server)
  }
})
