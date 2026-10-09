import { createServer } from 'node:http'
import type { HronautApi } from '../../src/shared/types.js'
import { closeFixtureServer, expect, test } from './fixtures.js'

test('keeps match-navigation focus during and after a real page search', async ({ appWindow, electronApp }) => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' }).end('<title>Find focus fixture</title><p>needle needle needle</p>')
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture port')
  const url = `http://127.0.0.1:${address.port}/`
  try {
    await appWindow.evaluate(url => (window as unknown as { hronaut: HronautApi }).hronaut.newTab({ url, active: true }), url)
    await expect.poll(() => appWindow.evaluate(() => (window as unknown as { hronaut: HronautApi }).hronaut.getState().then(state => state.tabs.find(tab => tab.active)?.loading))).toBe(false)
    await appWindow.getByRole('button', { name: 'Find in page', exact: true }).click()
    const bar = appWindow.getByRole('search', { name: 'Find in page' })
    await bar.getByRole('searchbox', { name: 'Find text' }).fill('needle')
    await expect(bar.locator('.find-count')).toHaveText('1 / 3')
    await electronApp.evaluate(({ ipcMain }) => {
      type Handler = (event: Electron.IpcMainInvokeEvent, ...args: unknown[]) => unknown
      const original = (ipcMain as typeof ipcMain & { _invokeHandlers: Map<string, Handler> })._invokeHandlers.get('browser:find-in-page')!
      let release: (() => void) | undefined
      let requests = 0
      Reflect.set(ipcMain, 'findFocusRequests', () => requests)
      ipcMain.removeHandler('browser:find-in-page')
      ipcMain.handle('browser:find-in-page', async (event, ...args: unknown[]) => {
        requests += 1
        const result = await original(event, ...args)
        await new Promise<void>(resolve => { release = resolve; ipcMain.once('qa:release-find-focus', () => resolve()) })
        return result
      })
      ipcMain.once('qa:restore-find-focus', () => {
        release?.()
        ipcMain.removeAllListeners('qa:release-find-focus')
        ipcMain.removeHandler('browser:find-in-page')
        ipcMain.handle('browser:find-in-page', original)
        Reflect.deleteProperty(ipcMain, 'findFocusRequests')
      })
    })
    for (const [index, label] of ['Next match', 'Previous match'].entries()) {
      const button = bar.getByRole('button', { name: label })
      await button.focus()
      await appWindow.keyboard.press('Enter')
      await expect.poll(() => electronApp.evaluate(({ ipcMain }) => ipcMain.listenerCount('qa:release-find-focus'))).toBe(1)
      await expect(bar.locator('.find-count')).toHaveText('Searching…')
      await expect(button).toBeFocused()
      await appWindow.keyboard.press('Enter')
      expect(await electronApp.evaluate(({ ipcMain }) => Reflect.get(ipcMain, 'findFocusRequests')())).toBe(index + 1)
      await electronApp.evaluate(({ ipcMain }) => ipcMain.emit('qa:release-find-focus'))
      await expect(bar.locator('.find-count')).toHaveText(index === 0 ? '2 / 3' : '1 / 3')
      await expect(button).toBeFocused()
    }
  } finally {
    await electronApp.evaluate(({ ipcMain }) => ipcMain.emit('qa:restore-find-focus'))
    await closeFixtureServer(server)
  }
})
