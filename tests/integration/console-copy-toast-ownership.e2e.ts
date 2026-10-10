import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { expect, test, text } from './capability-fixtures.js'

type ConsoleToastProbe = typeof globalThis & {
  consoleToastProbe?: { calls: number; failNext: boolean; reject(): void; restore(): void }
}

for (const action of ['filter', 'newer'] as const) {
  test(`suppresses an obsolete Console clipboard failure toast after ${action} ownership changes`, async ({ capabilities, appWindow, electronApp }) => {
    const { client, tabId, openPageTool } = capabilities
    const emitted = await client.callTool({ name: 'browser_evaluate', arguments: {
      tabId, script: "console.error('console-toast-fixture failure'); true"
    } }) as CallToolResult
    expect(emitted.isError, text(emitted)).not.toBe(true)
    await openPageTool('Open Console')
    const panel = appWindow.getByRole('dialog', { name: 'Console', exact: true })
    const filter = panel.getByRole('searchbox', { name: 'Filter Console messages', exact: true })
    await filter.fill('console-toast-fixture')
    await expect(panel.locator('.console-message')).toHaveCount(1)
    await electronApp.evaluate(({ ipcMain }) => {
      type Handler = (event: Electron.IpcMainInvokeEvent, ...args: unknown[]) => unknown
      const handlers = (ipcMain as typeof ipcMain & { _invokeHandlers: Map<string, Handler> })._invokeHandlers
      const original = handlers.get('browser:copy-text')
      if (!original) throw new Error('Missing clipboard handler')
      let reject!: (error: Error) => void
      const pending = new Promise<void>((_resolve, fail) => { reject = fail })
      const probe = { calls: 0, failNext: false,
        reject: () => reject(new Error('Obsolete Console clipboard refusal')),
        restore: () => {
          reject(new Error('Console toast fixture cleanup'))
          ipcMain.removeHandler('browser:copy-text')
          ipcMain.handle('browser:copy-text', original)
        }
      }
      ;(globalThis as ConsoleToastProbe).consoleToastProbe = probe
      ipcMain.removeHandler('browser:copy-text')
      ipcMain.handle('browser:copy-text', (event, ...args) => {
        probe.calls += 1
        if (probe.calls === 1) return pending
        if (probe.failNext) { probe.failNext = false; throw new Error('Current Console clipboard refusal') }
        return original(event, ...args)
      })
    })
    try {
      const copy = panel.getByRole('button', { name: /^(Copy|Copied) filtered$/ })
      await copy.click()
      await expect.poll(() => electronApp.evaluate(() => (globalThis as ConsoleToastProbe).consoleToastProbe?.calls)).toBe(1)
      if (action === 'filter') await filter.fill('console-toast-fixture failure')
      else {
        await panel.getByRole('button', { name: 'Copy all', exact: true }).click()
        await expect(panel.getByRole('button', { name: 'Copied all', exact: true })).toBeVisible()
      }
      await electronApp.evaluate(() => { (globalThis as ConsoleToastProbe).consoleToastProbe?.reject() })
      await appWindow.evaluate('window.hronaut.getState()')
      await appWindow.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())))
      expect(await appWindow.locator('.app-toast').filter({ hasText: 'Obsolete Console clipboard refusal' }).count()).toBe(0)
      expect(await copy.innerText()).toBe('Copy filtered')
      if (action === 'newer') await expect(panel.getByRole('button', { name: 'Copied all', exact: true })).toBeVisible()
      await electronApp.evaluate(() => {
        const probe = (globalThis as ConsoleToastProbe).consoleToastProbe
        if (probe) probe.failNext = true
      })
      await copy.click()
      await expect(appWindow.getByRole('alert').filter({ hasText: 'Current Console clipboard refusal' })).toBeVisible()
      await expect(copy).toHaveText('Copy filtered')
    } finally {
      await electronApp.evaluate(() => {
        const scope = globalThis as ConsoleToastProbe
        scope.consoleToastProbe?.restore()
        delete scope.consoleToastProbe
      })
    }
  })
}
