import { createServer } from 'node:http'
import type { HronautApi } from '../../src/shared/types.js'
import { closeFixtureServer, expect, test } from './fixtures.js'

for (const replacement of [false, true]) {
  test(`keeps fallback wake ${replacement ? 'superseded by navigation' : 'recoverable after an isolated failure'}`, async ({ appWindow, electronApp }) => {
    const server = createServer((request, response) => {
      response.writeHead(200, { 'content-type': 'text/html' })
      response.end(`<!doctype html><title>Wake fallback fixture</title><main>${request.url === '/new' ? 'New document' : 'Original document'}</main>`)
    })
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    let pageId: number | undefined
    try {
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('Missing fixture port')
      const url = `http://127.0.0.1:${address.port}/old`
      const newUrl = `http://127.0.0.1:${address.port}/new`
      const tabId = await appWindow.evaluate(`window.hronaut.newTab({ url: ${JSON.stringify(url)}, active: true }).then(state => state.activeTabId)`)
      await appWindow.evaluate("window.hronaut.newTab({ url: 'about:blank', active: true })")
      await expect.poll(() => appWindow.evaluate(`window.hronaut.getState().then(state => state.tabs.find(tab => tab.id === ${JSON.stringify(tabId)})?.loading)`)).toBe(false)
      pageId = await electronApp.evaluate(({ webContents }, url) => webContents.getAllWebContents().find(page => page.getURL() === url)?.id, url)
      if (!pageId) throw new Error('Missing fixture WebContents')
      await appWindow.evaluate(`window.hronaut.setTabSleeping(${JSON.stringify(tabId)}, true)`)
      await electronApp.evaluate(({ webContents }, id) => {
        const page = webContents.fromId(id)!
        const originalRestore = page.navigationHistory.restore
        const originalLoad = page.loadURL
        const control = {
          started: false,
          reject: () => {},
          restore: () => {
            Object.defineProperty(page.navigationHistory, 'restore', { configurable: true, value: originalRestore })
            page.loadURL = originalLoad
          }
        }
        Object.defineProperty(page.navigationHistory, 'restore', {
          configurable: true,
          value: async () => { throw new Error('Synthetic history restore failure') }
        })
        page.loadURL = (...args) => {
          if (control.started) return originalLoad.apply(page, args)
          control.started = true
          return new Promise<void>((_resolve, reject) => {
            control.reject = () => reject(Object.assign(new Error('Synthetic fallback abort'), { code: 'ERR_ABORTED' }))
          })
        }
        Reflect.set(page, 'wakeFallbackFixture', control)
      }, pageId)
      await appWindow.evaluate(`(() => {
        window.wakeFallbackOutcome = 'pending';
        window.hronaut.setTabSleeping(${JSON.stringify(tabId)}, false)
          .then(() => { window.wakeFallbackOutcome = 'resolved'; }, () => { window.wakeFallbackOutcome = 'rejected'; });
      })()`)
      await expect.poll(() => electronApp.evaluate(({ webContents }, id) => Reflect.get(webContents.fromId(id)!, 'wakeFallbackFixture').started, pageId!)).toBe(true)
      if (replacement) await appWindow.evaluate(({ url, tabId }) => (
        window as unknown as { hronaut: HronautApi }
      ).hronaut.navigate({ url, tabId }), { url: newUrl, tabId: tabId as string })
      await electronApp.evaluate(({ webContents }, id) => Reflect.get(webContents.fromId(id)!, 'wakeFallbackFixture').reject(), pageId)
      await expect.poll(() => appWindow.evaluate('window.wakeFallbackOutcome')).toBe(replacement ? 'resolved' : 'rejected')
      expect(await appWindow.evaluate(`window.hronaut.getState().then(state => state.tabs.find(tab => tab.id === ${JSON.stringify(tabId)})?.sleeping)`)).toBe(!replacement)
      await electronApp.evaluate(({ webContents }, id) => {
        const page = webContents.fromId(id)!
        Reflect.get(page, 'wakeFallbackFixture').restore()
        Reflect.deleteProperty(page, 'wakeFallbackFixture')
      }, pageId)
      if (!replacement) await appWindow.evaluate(`window.hronaut.setTabSleeping(${JSON.stringify(tabId)}, false)`)
      expect(await electronApp.evaluate(({ webContents }, id) => webContents.fromId(id)!.executeJavaScript('document.body.innerText'), pageId))
        .toContain(replacement ? 'New document' : 'Original document')
      expect(await appWindow.evaluate(`window.hronaut.getState().then(state => state.tabs.find(tab => tab.id === ${JSON.stringify(tabId)})?.sleeping)`)).toBe(false)
    } finally {
      if (pageId) await electronApp.evaluate(({ webContents }, id) => {
        const page = webContents.fromId(id)
        if (page) {
          Reflect.get(page, 'wakeFallbackFixture')?.reject()
          Reflect.get(page, 'wakeFallbackFixture')?.restore()
          Reflect.deleteProperty(page, 'wakeFallbackFixture')
        }
      }, pageId)
      await appWindow.evaluate('delete window.wakeFallbackOutcome')
      await closeFixtureServer(server)
    }
  })
}
