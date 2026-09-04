import { createServer } from 'node:http'
import type { HronautApi } from '../../src/shared/types.js'
import { closeFixtureServer, expect, test } from './fixtures.js'

for (const canceled of [true, false]) {
  for (const selection of ['replacement', 'other', 'reordered'] as const) {
    test(`keeps the ${selection} page visible when a delayed tab close ${canceled ? 'is canceled' : 'finishes'}`, async ({ appWindow, electronApp }) => {
      const server = createServer((request, response) => {
        response.writeHead(200, { 'content-type': 'text/html' })
        response.end(`<!doctype html><title>${request.url}</title><input id="draft"><script>
          if (location.pathname === '/draft' && ${canceled}) addEventListener('beforeunload', event => {
            event.preventDefault(); event.returnValue = '';
          });
        </script>`)
      })
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject)
        server.listen(0, '127.0.0.1', resolve)
      })
      const suppressAutomaticDialogDismissal = () => undefined
      const monitoredPages = electronApp.context().pages()
      try {
        const address = server.address()
        if (!address || typeof address === 'string') throw new Error('Fixture server has no port')
        const base = `http://127.0.0.1:${address.port}`
        const ids = await appWindow.evaluate(async (baseUrl) => {
          const api = (window as unknown as { hronaut: HronautApi }).hronaut
          const draft = (await api.newTab({ url: `${baseUrl}/draft`, active: true })).activeTabId!
          const replacement = (await api.newTab({ url: `${baseUrl}/replacement`, active: true })).activeTabId!
          const other = (await api.newTab({ url: `${baseUrl}/other`, active: true })).activeTabId!
          await api.selectTab(draft)
          return { draft, replacement, other }
        }, base)
        await expect.poll(() => appWindow.evaluate(() => (
          window as unknown as { hronaut: HronautApi }
        ).hronaut.getState().then(state => state.tabs.every(tab => !tab.loading)))).toBe(true)
        await electronApp.evaluate(async ({ webContents, dialog }, url) => {
          const page = webContents.getAllWebContents().find(contents => contents.getURL() === url)
          if (!page) throw new Error('Draft page missing')
          page.focus()
          await page.executeJavaScript("document.querySelector('#draft').focus()")
          page.sendInputEvent({ type: 'char', keyCode: 'x' })
          const originalClose = page.close.bind(page)
          const originalDialog = dialog.showMessageBox
          const control = {
            started: false,
            release: undefined as (() => void) | undefined,
            restore: () => {
              if (!page.isDestroyed()) Object.defineProperty(page, 'close', { configurable: true, value: originalClose })
              Object.defineProperty(dialog, 'showMessageBox', { configurable: true, value: originalDialog })
            }
          }
          ;(globalThis as typeof globalThis & { __delayedClose?: typeof control }).__delayedClose = control
          Object.defineProperty(page, 'close', { configurable: true, value: (options: Parameters<typeof originalClose>[0]) => {
            control.started = true
            control.release = () => originalClose(options)
          } })
          Object.defineProperty(dialog, 'showMessageBox', { configurable: true, value: async () => ({ response: 0, checkboxChecked: false }) })
        }, `${base}/draft`)
        monitoredPages.push(...electronApp.context().pages().filter(page => !monitoredPages.includes(page)))
        for (const page of monitoredPages) page.on('dialog', suppressAutomaticDialogDismissal)
        await appWindow.evaluate((tabId) => {
          const scope = window as unknown as { hronaut: HronautApi; __closeResult?: Promise<unknown> }
          scope.__closeResult = scope.hronaut.closeTab(tabId)
        }, ids.draft)
        await expect.poll(() => electronApp.evaluate(() => (
          globalThis as typeof globalThis & { __delayedClose?: { started: boolean } }
        ).__delayedClose?.started)).toBe(true)
        if (selection === 'reordered') {
          await appWindow.evaluate(({ draft, other }) => (window as unknown as { hronaut: HronautApi }).hronaut.reorderTab(other, draft, 'after'), ids)
        } else {
          await appWindow.evaluate((id) => (window as unknown as { hronaut: HronautApi }).hronaut.selectTab(id), ids[selection])
        }
        const expectedSelection = selection === 'reordered' ? (canceled ? 'draft' : 'other') : selection
        await electronApp.evaluate(() => (globalThis as typeof globalThis & {
          __delayedClose?: { release?: () => void }
        }).__delayedClose?.release?.())
        await appWindow.evaluate(() => (window as unknown as { __closeResult?: Promise<unknown> }).__closeResult)
        const afterClose = await appWindow.evaluate(() => (window as unknown as { hronaut: HronautApi }).hronaut.getState())
        expect(afterClose.activeTabId).toBe(ids[expectedSelection])
        expect(afterClose.tabs.some(tab => tab.id === ids.draft)).toBe(canceled)
        expect(afterClose.closedTabs.filter(tab => tab.url === `${base}/draft`)).toHaveLength(canceled ? 0 : 1)
        await expect.poll(() => electronApp.evaluate(({ BrowserWindow }, baseUrl) => (
          BrowserWindow.getAllWindows()[0]!.contentView.children.flatMap(view => {
            const contents = (view as Electron.WebContentsView).webContents
            if (!contents || contents.isDestroyed() || !view.getVisible()) return []
            const url = contents.getURL()
            return url.startsWith(baseUrl) ? [url] : []
          })
        ), base)).toEqual([`${base}/${expectedSelection}`])
        if (canceled) expect(await electronApp.evaluate(async ({ webContents }, url) => (
          webContents.getAllWebContents().find(contents => contents.getURL() === url)?.executeJavaScript("document.querySelector('#draft').value")
        ), `${base}/draft`)).toBe('x')
      } finally {
        for (const page of monitoredPages) page.off('dialog', suppressAutomaticDialogDismissal)
        await electronApp.evaluate(() => {
          const scope = globalThis as typeof globalThis & { __delayedClose?: { restore: () => void } }
          scope.__delayedClose?.restore()
          delete scope.__delayedClose
        })
        await closeFixtureServer(server)
      }
    })
  }
}
