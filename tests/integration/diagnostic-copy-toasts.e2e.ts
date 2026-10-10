import { expect, test } from './capability-fixtures.js'

type DiagnosticToastProbe = typeof globalThis & {
  diagnosticToastProbe?: { calls: number; failNext: boolean; reject(): void; restore(): void }
}

for (const action of ['refresh', 'newer'] as const) {
  test(`suppresses an obsolete diagnostic clipboard failure toast after ${action} ownership changes`, async ({ capabilities, appWindow, electronApp }) => {
    const { tabId, openPageTool } = capabilities
    await openPageTool('Create debug report')
    const panel = appWindow.getByRole('dialog', { name: 'Debug report', exact: true })
    await expect(panel.getByRole('button', { name: 'Copy report', exact: true })).toBeEnabled()
    await electronApp.evaluate(({ ipcMain }) => {
      type Handler = (event: Electron.IpcMainInvokeEvent, ...args: unknown[]) => unknown
      const handlers = (ipcMain as typeof ipcMain & { _invokeHandlers: Map<string, Handler> })._invokeHandlers
      const original = handlers.get('browser:copy-text')
      if (!original) throw new Error('Missing clipboard handler')
      let reject!: (error: Error) => void
      const pending = new Promise<void>((_resolve, fail) => { reject = fail })
      const probe = { calls: 0, failNext: false,
        reject: () => reject(new Error('Obsolete diagnostic clipboard refusal')),
        restore: () => {
          reject(new Error('Diagnostic toast fixture cleanup'))
          ipcMain.removeHandler('browser:copy-text')
          ipcMain.handle('browser:copy-text', original)
        }
      }
      ;(globalThis as DiagnosticToastProbe).diagnosticToastProbe = probe
      ipcMain.removeHandler('browser:copy-text')
      ipcMain.handle('browser:copy-text', (event, ...args) => {
        probe.calls += 1
        if (probe.calls === 1) return pending
        if (probe.failNext) { probe.failNext = false; throw new Error('Current diagnostic clipboard refusal') }
        return original(event, ...args)
      })
    })
    try {
      const copy = panel.getByRole('button', { name: /^(Copy report|Copied)$/ })
      await copy.click()
      await expect.poll(() => electronApp.evaluate(() => (globalThis as DiagnosticToastProbe).diagnosticToastProbe?.calls)).toBe(1)
      if (action === 'refresh') {
        await panel.getByRole('button', { name: 'Refresh', exact: true }).click()
        await expect(copy).toBeEnabled()
      } else {
        await copy.click()
        await expect(copy).toHaveText('Copied')
        expect(JSON.parse(await electronApp.evaluate(({ clipboard }) => clipboard.readText()))).toMatchObject({ tabId, summary: { failedRequests: expect.any(Number) } })
      }
      await electronApp.evaluate(() => { (globalThis as DiagnosticToastProbe).diagnosticToastProbe?.reject() })
      await appWindow.evaluate('window.hronaut.getState()')
      await appWindow.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())))
      expect(await appWindow.locator('.app-toast').filter({ hasText: 'Obsolete diagnostic clipboard refusal' }).count()).toBe(0)
      expect((await copy.innerText()).trim()).toBe(action === 'newer' ? 'Copied' : 'Copy report')
      await electronApp.evaluate(() => {
        const probe = (globalThis as DiagnosticToastProbe).diagnosticToastProbe
        if (probe) probe.failNext = true
      })
      await copy.click()
      await expect(appWindow.getByRole('alert').filter({ hasText: 'Current diagnostic clipboard refusal' })).toBeVisible()
      await expect(copy).toHaveText('Copy report')
    } finally {
      await electronApp.evaluate(() => {
        const scope = globalThis as DiagnosticToastProbe
        scope.diagnosticToastProbe?.restore()
        delete scope.diagnosticToastProbe
      })
    }
  })
}
