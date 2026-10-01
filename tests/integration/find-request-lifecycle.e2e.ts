import { createServer } from 'node:http'
import { closeFixtureServer, expect, test } from './fixtures.js'

test('settles superseded and stopped page searches and permits a real search afterward', async ({ appWindow, electronApp }) => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end('<!doctype html><title>Find cancellation fixture</title><p>needle needle needle different</p>')
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
    const bar = appWindow.getByRole('search', { name: 'Find in page' })
    await appWindow.getByRole('button', { name: 'Find in page', exact: true }).click()
    await bar.getByRole('searchbox', { name: 'Find text' }).fill('needle')
    await expect(bar.locator('.find-count')).toHaveText('1 / 3')
    await electronApp.evaluate(({ ipcMain }) => {
      type Handler = (event: Electron.IpcMainInvokeEvent, ...args: unknown[]) => unknown
      const original = (ipcMain as typeof ipcMain & { _invokeHandlers: Map<string, Handler> })._invokeHandlers.get('browser:find-in-page')!
      let release: (() => void) | undefined
      ipcMain.removeHandler('browser:find-in-page')
      ipcMain.handle('browser:find-in-page', async (event, ...args: unknown[]) => {
        const result = await original(event, ...args)
        await new Promise<void>(resolve => { release = resolve; ipcMain.once('qa:release-page-find', () => resolve()) })
        return result
      })
      ipcMain.once('qa:restore-page-find', () => {
        release?.()
        ipcMain.removeAllListeners('qa:release-page-find')
        ipcMain.removeHandler('browser:find-in-page')
        ipcMain.handle('browser:find-in-page', original)
      })
    })
    try {
      await bar.getByRole('searchbox', { name: 'Find text' }).fill('different')
      await expect.poll(() => electronApp.evaluate(({ ipcMain }) => ipcMain.listenerCount('qa:release-page-find'))).toBe(1)
      await expect(bar.locator('.find-count')).toHaveText('Searching…')
      await expect(bar.locator('.find-count')).toHaveAttribute('aria-busy', 'true')
      await expect(bar.getByRole('button', { name: 'Next match' })).toBeDisabled()
      await expect(bar.getByRole('button', { name: 'Previous match' })).toBeDisabled()
      await electronApp.evaluate(({ ipcMain }) => ipcMain.emit('qa:release-page-find'))
      await expect(bar.locator('.find-count')).toHaveText('1 / 1')
      await expect(bar.locator('.find-count')).toHaveAttribute('aria-busy', 'false')
      await expect(bar.getByRole('button', { name: 'Next match' })).toBeEnabled()
    } finally {
      await electronApp.evaluate(({ ipcMain }) => ipcMain.emit('qa:restore-page-find'))
    }

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
