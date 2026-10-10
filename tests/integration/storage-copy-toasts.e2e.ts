import { expect, test } from './capability-fixtures.js'

type StorageToastProbe = typeof globalThis & {
  storageToastProbe?: { calls: number; failNext: boolean; reject(): void; restore(): void }
}

for (const action of ['refresh', 'newer', 'close'] as const) {
  test(`suppresses an obsolete storage clipboard failure toast after ${action} ownership changes`, async ({ capabilities, appWindow, electronApp }) => {
    const { tabId, openPageTool } = capabilities
    await openPageTool('Site storage for 127.0.0.1')
    const panel = appWindow.getByRole('dialog', { name: /Site storage/ })
    await panel.getByRole('button', { name: 'Overview', exact: true }).click()
    await expect(panel).toContainText('Chromium quota detail')
    await electronApp.evaluate(({ ipcMain }) => {
      type Handler = (event: Electron.IpcMainInvokeEvent, ...args: unknown[]) => unknown
      const handlers = (ipcMain as typeof ipcMain & { _invokeHandlers: Map<string, Handler> })._invokeHandlers
      const original = handlers.get('browser:copy-text')
      if (!original) throw new Error('Missing clipboard handler')
      let reject!: (error: Error) => void
      const pending = new Promise<void>((_resolve, fail) => { reject = fail })
      const probe = { calls: 0, failNext: false,
        reject: () => reject(new Error('Obsolete storage clipboard refusal')),
        restore: () => {
          reject(new Error('Storage toast fixture cleanup'))
          ipcMain.removeHandler('browser:copy-text')
          ipcMain.handle('browser:copy-text', original)
        }
      }
      ;(globalThis as StorageToastProbe).storageToastProbe = probe
      ipcMain.removeHandler('browser:copy-text')
      ipcMain.handle('browser:copy-text', (event, ...args) => {
        probe.calls += 1
        if (probe.calls === 1) return pending
        if (probe.failNext) { probe.failNext = false; throw new Error('Current storage clipboard refusal') }
        return original(event, ...args)
      })
    })
    try {
      const copy = panel.getByRole('button', { name: /^(Copy report|Copied)$/ })
      await copy.click()
      await expect.poll(() => electronApp.evaluate(() => (globalThis as StorageToastProbe).storageToastProbe?.calls)).toBe(1)
      if (action === 'refresh') {
        await panel.getByRole('button', { name: 'Refresh', exact: true }).click()
        await expect(copy).toBeEnabled()
      } else if (action === 'close') {
        await panel.getByRole('button', { name: 'Close site storage', exact: true }).click()
        await expect(panel).toBeHidden()
      } else {
        await copy.click()
        await expect(copy).toHaveText('Copied')
        expect(JSON.parse(await electronApp.evaluate(({ clipboard }) => clipboard.readText()))).toMatchObject({ tabId, source: 'chromium-quota' })
      }
      await electronApp.evaluate(() => { (globalThis as StorageToastProbe).storageToastProbe?.reject() })
      await appWindow.evaluate('window.hronaut.getState()')
      await appWindow.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())))
      expect(await appWindow.locator('.app-toast').filter({ hasText: 'Obsolete storage clipboard refusal' }).count()).toBe(0)
      if (action === 'close') {
        await openPageTool('Site storage for 127.0.0.1')
        await panel.getByRole('button', { name: 'Overview', exact: true }).click()
        await expect(copy).toBeEnabled()
      }
      expect((await copy.innerText()).trim()).toBe(action === 'newer' ? 'Copied' : 'Copy report')
      await electronApp.evaluate(() => {
        const probe = (globalThis as StorageToastProbe).storageToastProbe
        if (probe) probe.failNext = true
      })
      await copy.click()
      await expect(appWindow.getByRole('alert').filter({ hasText: 'Current storage clipboard refusal' })).toBeVisible()
      await expect(copy).toHaveText('Copy report')
    } finally {
      await electronApp.evaluate(() => {
        const scope = globalThis as StorageToastProbe
        scope.storageToastProbe?.restore()
        delete scope.storageToastProbe
      })
    }
  })
}
