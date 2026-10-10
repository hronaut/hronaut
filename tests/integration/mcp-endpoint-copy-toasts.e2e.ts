import { expect, test } from './fixtures.js'

type EndpointToastProbe = typeof globalThis & {
  endpointToastProbe?: { calls: number; failNext: boolean; reject(): void; restore(): void }
}

for (const newerSuccess of [true, false]) {
  test(`suppresses an obsolete MCP endpoint clipboard error after a newer copy (success: ${newerSuccess})`, async ({ appWindow, electronApp, mcpPort }) => {
    await appWindow.getByRole('button', { name: 'MCP ready', exact: true }).click()
    const summary = appWindow.locator('.mcp-readiness-summary')
    await electronApp.evaluate(({ ipcMain }) => {
      type Handler = (event: Electron.IpcMainInvokeEvent, ...args: unknown[]) => unknown
      const handlers = (ipcMain as typeof ipcMain & { _invokeHandlers: Map<string, Handler> })._invokeHandlers
      const original = handlers.get('browser:copy-text')
      if (!original) throw new Error('Missing clipboard handler')
      let reject!: (error: Error) => void
      const pending = new Promise<void>((_resolve, fail) => { reject = fail })
      const probe = { calls: 0, failNext: false,
        reject: () => reject(new Error('Obsolete endpoint clipboard refusal')),
        restore: () => {
          reject(new Error('Endpoint toast fixture cleanup'))
          ipcMain.removeHandler('browser:copy-text')
          ipcMain.handle('browser:copy-text', original)
        }
      }
      ;(globalThis as EndpointToastProbe).endpointToastProbe = probe
      ipcMain.removeHandler('browser:copy-text')
      ipcMain.handle('browser:copy-text', (event, ...args) => {
        probe.calls += 1
        if (probe.calls === 1) return pending
        if (probe.failNext) { probe.failNext = false; throw new Error('Current endpoint clipboard refusal') }
        return original(event, ...args)
      })
    })
    try {
      const copy = summary.getByRole('button', { name: /^(Copy URL|MCP URL copied)$/ })
      await copy.click()
      await expect.poll(() => electronApp.evaluate(() => (globalThis as EndpointToastProbe).endpointToastProbe?.calls)).toBe(1)
      if (!newerSuccess) await electronApp.evaluate(() => {
        const probe = (globalThis as EndpointToastProbe).endpointToastProbe
        if (probe) probe.failNext = true
      })
      await copy.click()
      if (newerSuccess) {
        await expect(copy).toHaveText('MCP URL copied')
        expect(await electronApp.evaluate(({ clipboard }) => clipboard.readText())).toBe(`http://127.0.0.1:${mcpPort}/mcp`)
      } else {
        await expect(appWindow.getByRole('alert').filter({ hasText: 'Current endpoint clipboard refusal' })).toBeVisible()
        await expect(copy).toHaveText('Copy URL')
      }
      await electronApp.evaluate(() => { (globalThis as EndpointToastProbe).endpointToastProbe?.reject() })
      await appWindow.evaluate('window.hronaut.getState()')
      await appWindow.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())))
      expect(await appWindow.locator('.app-toast').filter({ hasText: 'Obsolete endpoint clipboard refusal' }).count()).toBe(0)
      expect((await copy.innerText()).trim()).toBe(newerSuccess ? 'MCP URL copied' : 'Copy URL')
      if (newerSuccess) {
        await electronApp.evaluate(() => {
          const probe = (globalThis as EndpointToastProbe).endpointToastProbe
          if (probe) probe.failNext = true
        })
        await copy.click()
      }
      await expect(appWindow.getByRole('alert').filter({ hasText: 'Current endpoint clipboard refusal' })).toBeVisible()
      await expect(copy).toHaveText('Copy URL')
      await expect(appWindow.getByRole('button', { name: 'Pause agents', exact: true })).toBeEnabled()
    } finally {
      await electronApp.evaluate(() => {
        const scope = globalThis as EndpointToastProbe
        scope.endpointToastProbe?.restore()
        delete scope.endpointToastProbe
      })
    }
  })
}
