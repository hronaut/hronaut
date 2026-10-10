import { expect, test } from './capability-fixtures.js'

type SearchGate = { ready: boolean; released: boolean; release(): void; restore(): void }
type SearchGlobal = typeof globalThis & { __networkSearchInputGate?: SearchGate }

for (const edit of ['query', 'case'] as const) {
  for (const outcome of ['success', 'failure'] as const) {
    test(`Network content search retires a ${outcome} reply after ${edit} edits`, async ({ capabilities, electronApp, appWindow }) => {
      await capabilities.openPageTool('Open network monitor')
      const panel = appWindow.getByRole('dialog', { name: 'Network', exact: true })
      await panel.getByRole('button', { name: 'Search request content', exact: true }).click()
      const search = panel.getByRole('region', { name: 'Search request content' })
      await electronApp.evaluate(async ({ webContents }, url) => {
        const page = webContents.getAllWebContents().find(contents => contents.getURL() === url)!
        await page.executeJavaScript("fetch('/api-details?search-ownership=1', {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({query:'fixture'})}).then(response => response.text())")
      }, capabilities.fixtureUrl)
      const query = search.getByRole('searchbox')
      await query.fill('network-detail-42')
      await search.getByRole('button', { name: 'Search', exact: true }).click()
      await expect(search.getByRole('button', { name: /Inspect matching request .*x-request-id/ }).first()).toBeVisible()
      await electronApp.evaluate(({ ipcMain }, fail) => {
        type Handler = (event: Electron.IpcMainInvokeEvent, ...args: unknown[]) => unknown
        const original = (ipcMain as typeof ipcMain & { _invokeHandlers: Map<string, Handler> })._invokeHandlers.get('browser:network-search')!
        let release!: () => void
        const barrier = new Promise<void>(resolve => { release = resolve })
        const gate: SearchGate = {
          ready: false, released: false, release,
          restore: () => {
            ipcMain.removeHandler('browser:network-search')
            ipcMain.handle('browser:network-search', original)
          }
        }
        ;(globalThis as SearchGlobal).__networkSearchInputGate = gate
        ipcMain.removeHandler('browser:network-search')
        ipcMain.handle('browser:network-search', async (event, ...args: unknown[]) => {
          const result = await original(event, ...args)
          if (!gate.ready) {
            gate.ready = true
            await barrier
            gate.released = true
            if (fail) throw new Error('Controlled old search delivery failure')
          }
          return result
        })
      }, outcome === 'failure')
      try {
        await search.getByRole('button', { name: 'Search', exact: true }).click()
        await expect.poll(() => electronApp.evaluate(() => (globalThis as SearchGlobal).__networkSearchInputGate?.ready)).toBe(true)
        if (edit === 'query') await query.fill('no-matching-fixture-text')
        else await search.getByRole('checkbox', { name: 'Match case' }).check()
        // Editing must retire the old pending state without automatically searching.
        await expect(search.getByRole('button', { name: 'Search', exact: true })).toBeEnabled()
        await expect(search.locator('header')).toHaveCount(0)
        await electronApp.evaluate(() => (globalThis as SearchGlobal).__networkSearchInputGate!.release())
        await expect.poll(() => electronApp.evaluate(() => (globalThis as SearchGlobal).__networkSearchInputGate?.released)).toBe(true)
        // A fresh real search remains usable and owns its result after the retired reply.
        await search.getByRole('button', { name: 'Search', exact: true }).click()
        await expect(search.locator('header')).toBeVisible()
        if (edit === 'query') {
          await expect(search).toContainText('no-matching-fixture-text')
          await expect(search.getByRole('button', { name: /Inspect matching request/ })).toHaveCount(0)
        } else {
          await expect(search.getByRole('button', { name: /Inspect matching request .*x-request-id/ }).first()).toBeVisible()
          await expect(search.getByRole('checkbox', { name: 'Match case' })).toBeChecked()
        }
        await expect(search.getByRole('alert')).toHaveCount(0)
        await expect(search).not.toContainText('request-secret')
      } finally {
        await electronApp.evaluate(() => {
          const scope = globalThis as SearchGlobal
          scope.__networkSearchInputGate?.release()
          scope.__networkSearchInputGate?.restore()
          delete scope.__networkSearchInputGate
        }).catch(() => undefined)
      }
    })
  }
}
