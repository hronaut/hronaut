import { expect, test } from './capability-fixtures.js'

type CloseCopyGate = { waiting: boolean; settled: boolean; calls: number; release(): void; restore(): void }
type CloseCopyScope = typeof globalThis & { __consoleCloseCopy?: CloseCopyGate }

for (const reopen of [false, true]) for (const fail of [false, true]) {
  test(`Console close${reopen ? '/reopen' : ''} retires delayed clipboard ${fail ? 'failure' : 'success'}`, async ({ capabilities, appWindow, electronApp }) => {
    const { fixtureUrl, openPageTool } = capabilities
    await electronApp.evaluate(async ({ webContents }, url) => {
      const page = webContents.getAllWebContents().find(page => page.getURL() === url)!
      await page.executeJavaScript("console.error('console-close-copy-fixture'); true")
    }, fixtureUrl)
    await openPageTool('Open Console')
    const panel = appWindow.getByRole('dialog', { name: 'Console', exact: true })
    await panel.getByRole('searchbox', { name: 'Filter Console messages', exact: true }).fill('console-close-copy-fixture')
    await expect(panel.locator('.console-message')).toHaveCount(1)
    await electronApp.evaluate(({ ipcMain }, fail) => {
      type Handler = (event: Electron.IpcMainInvokeEvent, ...args: unknown[]) => unknown
      const handlers = (ipcMain as typeof ipcMain & { _invokeHandlers: Map<string, Handler> })._invokeHandlers
      const original = handlers.get('browser:copy-text')!
      let release!: () => void
      const barrier = new Promise<void>(resolve => { release = resolve })
      const gate: CloseCopyGate = { waiting: false, settled: false, calls: 0, release, restore: () => {
        release(); ipcMain.removeHandler('browser:copy-text'); ipcMain.handle('browser:copy-text', original)
      } }
      ;(globalThis as CloseCopyScope).__consoleCloseCopy = gate
      ipcMain.removeHandler('browser:copy-text')
      ipcMain.handle('browser:copy-text', async (event, ...args) => {
        gate.calls++
        const result = await original(event, ...args)
        if (gate.calls === 1) {
          gate.waiting = true
          await barrier
          gate.settled = true
          if (fail) throw new Error('Closed Console clipboard reply failure')
        }
        return result
      })
    }, fail)
    try {
      await panel.getByRole('button', { name: 'Copy filtered', exact: true }).click()
      await expect.poll(() => electronApp.evaluate(() => (globalThis as CloseCopyScope).__consoleCloseCopy?.waiting)).toBe(true)
      const copiedText = await electronApp.evaluate(({ clipboard }) => clipboard.readText())
      expect(JSON.parse(copiedText)).toMatchObject({ scope: 'filtered', messages: [{ message: 'console-close-copy-fixture' }] })
      await panel.getByRole('button', { name: 'Close Console', exact: true }).click()
      await expect(panel).toBeHidden()
      if (reopen) await openPageTool('Open Console')
      await electronApp.evaluate(() => (globalThis as CloseCopyScope).__consoleCloseCopy!.release())
      await expect.poll(() => electronApp.evaluate(() => (globalThis as CloseCopyScope).__consoleCloseCopy?.settled)).toBe(true)
      await appWindow.evaluate('window.hronaut.getState()')
      await appWindow.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())))
      expect(await appWindow.locator('.app-toast').filter({ hasText: 'Closed Console clipboard reply failure' }).count()).toBe(0)
      // A clipboard write already dispatched is retained; only feedback retires.
      expect(await electronApp.evaluate(({ clipboard }) => clipboard.readText())).toBe(copiedText)
      if (!reopen) await openPageTool('Open Console')
      expect(await panel.getByRole('button', { name: /^(Copy|Copied) filtered$/ }).innerText()).toBe('Copy filtered')
      await expect(panel.getByRole('searchbox', { name: 'Filter Console messages', exact: true })).toHaveValue('console-close-copy-fixture')
      await panel.getByRole('button', { name: 'Copy all', exact: true }).click()
      await expect(panel.getByRole('button', { name: 'Copied all', exact: true })).toBeVisible()
      expect(JSON.parse(await electronApp.evaluate(({ clipboard }) => clipboard.readText())).scope).toBe('all')
    } finally {
      await electronApp.evaluate(() => { (globalThis as CloseCopyScope).__consoleCloseCopy?.restore(); delete (globalThis as CloseCopyScope).__consoleCloseCopy }).catch(() => undefined)
    }
  })
}
