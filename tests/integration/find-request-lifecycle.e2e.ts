import { createServer } from 'node:http'
import { closeFixtureServer, expect, test } from './fixtures.js'

test('settles superseded and stopped page searches and permits a real search afterward', async ({ appWindow, electronApp }) => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end('<!doctype html><title>Find cancellation fixture</title><p>needle needle needle</p>')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture port')
  const url = `http://127.0.0.1:${address.port}/`
  try {
    const tabId = await appWindow.evaluate(`window.hronaut.newTab({ url: ${JSON.stringify(url)}, active: true }).then(state => state.activeTabId)`)
    await expect.poll(() => appWindow.evaluate('window.hronaut.getState().then(state => state.tabs.find(tab => tab.active)?.loading)')).toBe(false)
    const baseline = await electronApp.evaluate(({ webContents }, url) => {
      const page = webContents.getAllWebContents().find(page => page.getURL() === url)
      if (!page) throw new Error('Missing find fixture')
      // Hold native completion deterministically while exercising the actual
      // preload/IPC/controller path; restore Chromium for the final real search.
      const original = page.findInPage
      let requestId = 0
      page.findInPage = () => ++requestId
      Reflect.set(page, 'restoreFindLifecycleFixture', () => { page.findInPage = original })
      return { found: page.listenerCount('found-in-page'), destroyed: page.listenerCount('destroyed') }
    }, url)
    await appWindow.evaluate(`(() => {
      window.findLifecycleResults = [];
      for (let index = 0; index < 12; index++) {
        window.hronaut.findInPage({ tabId: ${JSON.stringify(tabId)}, query: 'needle' + index })
          .then(() => window.findLifecycleResults.push('unexpected success'), error => window.findLifecycleResults.push(error.message));
      }
    })()`)
    await expect.poll(() => appWindow.evaluate('window.findLifecycleResults.length')).toBe(11)
    expect(await electronApp.evaluate(({ webContents }, url) => {
      const page = webContents.getAllWebContents().find(page => page.getURL() === url)!
      return { found: page.listenerCount('found-in-page'), destroyed: page.listenerCount('destroyed') }
    }, url)).toEqual({ found: baseline.found + 1, destroyed: baseline.destroyed + 1 })
    await appWindow.evaluate(`window.hronaut.stopFindInPage(${JSON.stringify(tabId)})`)
    await expect.poll(() => appWindow.evaluate('window.findLifecycleResults.length')).toBe(12)
    expect(await appWindow.evaluate('window.findLifecycleResults.every(message => message.includes("cancelled or superseded"))')).toBe(true)
    expect(await electronApp.evaluate(async ({ webContents }, url) => {
      const page = webContents.getAllWebContents().find(page => page.getURL() === url)!
      Reflect.get(page, 'restoreFindLifecycleFixture')()
      Reflect.deleteProperty(page, 'restoreFindLifecycleFixture')
      await page.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
      return { found: page.listenerCount('found-in-page'), destroyed: page.listenerCount('destroyed') }
    }, url)).toEqual(baseline)
    expect(await appWindow.evaluate(`window.hronaut.findInPage({ tabId: ${JSON.stringify(tabId)}, query: 'needle' })`))
      .toEqual({ activeMatchOrdinal: 1, matches: 3 })
    await appWindow.evaluate(`window.hronaut.stopFindInPage(${JSON.stringify(tabId)})`)
  } finally {
    await electronApp.evaluate(({ webContents }, url) => {
      const page = webContents.getAllWebContents().find(page => page.getURL() === url)
      if (page) {
        Reflect.get(page, 'restoreFindLifecycleFixture')?.()
        Reflect.deleteProperty(page, 'restoreFindLifecycleFixture')
      }
    }, url)
    await appWindow.evaluate('delete window.findLifecycleResults')
    await closeFixtureServer(server)
  }
})
