import { createServer } from 'node:http'
import type { HronautApi } from '../../src/shared/types.js'
import { closeFixtureServer, expect, test } from './fixtures.js'

for (const kind of ['element', 'area'] as const) {
  test(`keeps a replacement ${kind} selection owned after late cleanup`, async ({ appWindow, electronApp }) => {
    const server = createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/html' })
      response.end('<!doctype html><title>Selection cleanup fixture</title><main>Select this content</main>')
    })
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    let pageId: number | undefined
    let tabId: string | undefined
    try {
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('Missing fixture port')
      const url = `http://127.0.0.1:${address.port}/`
      tabId = await appWindow.evaluate(async url => {
        const api = (window as unknown as { hronaut: HronautApi }).hronaut
        const state = await api.newTab({ url, active: true })
        if (!state.activeTabId) throw new Error('Missing active tab')
        return state.activeTabId
      }, url)
      await expect.poll(() => appWindow.evaluate(() => (window as unknown as { hronaut: HronautApi }).hronaut.getState().then(state => state.tabs.find(tab => tab.active)?.loading))).toBe(false)
      pageId = await electronApp.evaluate(({ webContents }, { url, kind }) => {
        const page = webContents.getAllWebContents().find(page => page.getURL() === url)
        if (!page) throw new Error('Missing selection fixture')
        const original = page.executeJavaScript
        const key = kind === 'element' ? '__hronautElementPicker' : '__hronautScreenshotArea'
        const control = { starts: 0, cancels: 0, held: false, skipCancel: false, release: () => {}, restore: () => { page.executeJavaScript = original } }
        page.executeJavaScript = (...args) => {
          const [code] = args
          if (code.includes(`const pickerKey = '${key}'`)) control.starts += 1
          if (code.includes(`const picker = window.${key};`) && code.includes('picker.cancel();')) {
            control.cancels += 1
            if (control.skipCancel) return Promise.resolve(false)
            const operation = original.apply(page, args)
            // The explicit cancel runs first; hold the old request's finally
            // cleanup response after its real page script has completed.
            if (control.cancels === 2) return operation.then(value => new Promise(resolve => {
              control.held = true
              control.release = () => resolve(value)
            }))
            return operation
          }
          return original.apply(page, args)
        }
        Reflect.set(page, 'selectionCleanupFixture', control)
        return page.id
      }, { url, kind })
      const start = (slot: string) => appWindow.evaluate(({ kind, tabId, slot }) => {
        const api = (window as unknown as { hronaut: HronautApi }).hronaut
        Reflect.set(window, slot, 'pending')
        void api[kind === 'element' ? 'pickElement' : 'captureArea'](tabId).then(
          result => Reflect.set(window, slot, result),
          error => Reflect.set(window, slot, String(error))
        )
      }, { kind, tabId, slot })
      const cancel = () => appWindow.evaluate(({ kind, tabId }) => (
        window as unknown as { hronaut: HronautApi }
      ).hronaut[kind === 'element' ? 'cancelElementPicker' : 'cancelAreaCapture'](tabId), { kind, tabId })
      await start('firstSelectionOutcome')
      await expect.poll(() => electronApp.evaluate(({ webContents }, id) => Reflect.get(webContents.fromId(id)!, 'selectionCleanupFixture').starts, pageId!)).toBe(1)
      await cancel()
      await expect.poll(() => electronApp.evaluate(({ webContents }, id) => Reflect.get(webContents.fromId(id)!, 'selectionCleanupFixture').held, pageId!)).toBe(true)
      await start('secondSelectionOutcome')
      await expect.poll(() => electronApp.evaluate(({ webContents }, id) => Reflect.get(webContents.fromId(id)!, 'selectionCleanupFixture').starts, pageId!)).toBe(2)
      await electronApp.evaluate(({ webContents }, id) => {
        const control = Reflect.get(webContents.fromId(id)!, 'selectionCleanupFixture')
        control.skipCancel = true
        control.release()
      }, pageId)
      await expect.poll(() => appWindow.evaluate(() => Reflect.get(window, 'firstSelectionOutcome'))).toMatchObject({ canceled: true, copied: false })
      await cancel()
      // Main must settle cancellation even if the page cleanup returns no
      // result; an obsolete finally must not have erased this live session.
      await expect.poll(() => appWindow.evaluate(() => Reflect.get(window, 'secondSelectionOutcome'))).toMatchObject({ canceled: true, copied: false })
    } finally {
      if (pageId) await electronApp.evaluate(({ webContents }, id) => {
        const page = webContents.fromId(id)
        const control = page && Reflect.get(page, 'selectionCleanupFixture')
        control?.release()
        control?.restore()
        if (page) Reflect.deleteProperty(page, 'selectionCleanupFixture')
      }, pageId)
      if (tabId) await appWindow.evaluate(({ kind, tabId }) => (
        window as unknown as { hronaut: HronautApi }
      ).hronaut[kind === 'element' ? 'cancelElementPicker' : 'cancelAreaCapture'](tabId), { kind, tabId }).catch(() => undefined)
      await appWindow.evaluate(() => {
        Reflect.deleteProperty(window, 'firstSelectionOutcome')
        Reflect.deleteProperty(window, 'secondSelectionOutcome')
      })
      await closeFixtureServer(server)
    }
  })
}
