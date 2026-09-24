import { createServer } from 'node:http'
import { closeFixtureServer, expect, test } from './fixtures.js'

test('reannounces separate EVM and TRON providers to late route listeners without requesting accounts', async ({ appWindow, electronApp }) => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end('<!doctype html><title>Late wallet discovery</title><main>Discovery fixture</main>')
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Fixture port is unavailable')
    const url = `http://127.0.0.1:${address.port}/first`
    await appWindow.evaluate(`window.hronaut.newTab({ url: ${JSON.stringify(url)}, active: true })`)
    await expect.poll(() => appWindow.evaluate('window.hronaut.getState().then(state => state.tabs.find(tab => tab.active)?.title)'))
      .toBe('Late wallet discovery')
    expect(await appWindow.evaluate('window.hronautWallets.listRequests()')).toEqual([])

    const result = await electronApp.evaluate(async ({ webContents }, url) => {
      const page = webContents.getAllWebContents().find(contents => contents.getURL() === url)
      if (!page) throw new Error('Discovery page was not found')
      return page.executeJavaScript(`(() => {
        const evm = [];
        const tron = [];
        const onEvm = event => evm.push(event.detail);
        const onTron = event => tron.push(event.detail);
        window.addEventListener('eip6963:announceProvider', onEvm);
        window.addEventListener('TIP6963:announceProvider', onTron);
        try {
          window.dispatchEvent(new Event('eip6963:requestProvider'));
          const afterEvm = [evm.length, tron.length];
          window.dispatchEvent(new Event('TIP6963:requestProvider'));
          const afterTron = [evm.length, tron.length];
          history.pushState({}, '', '/second');
          window.dispatchEvent(new Event('eip6963:requestProvider'));
          window.dispatchEvent(new Event('TIP6963:requestProvider'));
          return {
            afterEvm, afterTron, finalCounts: [evm.length, tron.length],
            route: location.pathname,
            stableIdentity: evm[0]?.provider === evm[1]?.provider && tron[0]?.provider === tron[1]?.provider,
            distinctProviders: evm[0]?.provider !== tron[0]?.provider,
            ownGlobals: evm[0]?.provider === window.hronautEthereum && tron[0]?.provider === window.hronautTron,
            frozenMetadata: [...evm, ...tron].every(detail => Object.isFrozen(detail) && Object.isFrozen(detail.info)),
            stableIds: evm[0]?.info.uuid === evm[1]?.info.uuid && tron[0]?.info.uuid === tron[1]?.info.uuid,
            names: [evm[0]?.info.name, tron[0]?.info.name]
          };
        } finally {
          window.removeEventListener('eip6963:announceProvider', onEvm);
          window.removeEventListener('TIP6963:announceProvider', onTron);
        }
      })()`)
    }, url)
    expect(result).toEqual({
      afterEvm: [1, 0], afterTron: [1, 1], finalCounts: [2, 2], route: '/second',
      stableIdentity: true, distinctProviders: true, ownGlobals: true,
      frozenMetadata: true, stableIds: true, names: ['Hronaut', 'Hronaut']
    })
    expect(await appWindow.evaluate('window.hronautWallets.listRequests()')).toEqual([])
    await expect(appWindow.getByRole('alertdialog')).toHaveCount(0)
  } finally {
    await closeFixtureServer(server)
  }
})
