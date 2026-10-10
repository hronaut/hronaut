import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { expect, test, text } from './capability-fixtures.js'

type HarToastProbe = typeof globalThis & {
  harToastProbe?: { calls: number; failNext: boolean; reject(): void; restore(): void }
}

for (const action of ['filter', 'newer'] as const) {
  test(`suppresses an obsolete HAR clipboard failure toast after ${action} ownership changes`, async ({ capabilities, appWindow, electronApp }) => {
    const { client, tabId, openPageTool } = capabilities
    const retained = async () => {
      const result = await client.callTool({ name: 'browser_network', arguments: { tabId } }) as CallToolResult
      expect(result.isError, text(result)).not.toBe(true)
      return JSON.parse(text(result)) as Array<{ url: string; completedAt?: string }>
    }
    await retained()
    const fetched = await client.callTool({ name: 'browser_evaluate', arguments: {
      tabId, script: "fetch('/api-details?fixture=har-toast', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query: 'har-toast' }) }).then(response => response.text()).then(() => true)"
    } }) as CallToolResult
    expect(fetched.isError, text(fetched)).not.toBe(true)
    await expect.poll(async () => (await retained()).some(entry => entry.url.includes('fixture=har-toast') && entry.completedAt)).toBe(true)
    await openPageTool('Open network monitor')
    const panel = appWindow.getByRole('dialog', { name: 'Network', exact: true })
    const filter = panel.getByRole('searchbox', { name: 'Filter network requests', exact: true })
    await filter.fill('fixture=har-toast')
    await expect(panel.getByRole('listbox', { name: 'Network requests' }).getByRole('option')).toHaveCount(1)
    await electronApp.evaluate(({ ipcMain }) => {
      type Handler = (event: Electron.IpcMainInvokeEvent, ...args: unknown[]) => unknown
      const handlers = (ipcMain as typeof ipcMain & { _invokeHandlers: Map<string, Handler> })._invokeHandlers
      const original = handlers.get('browser:copy-text')
      if (!original) throw new Error('Missing clipboard handler')
      let reject!: (error: Error) => void
      const pending = new Promise<void>((_resolve, fail) => { reject = fail })
      const probe = { calls: 0, failNext: false,
        reject: () => reject(new Error('Obsolete HAR clipboard refusal')),
        restore: () => {
          reject(new Error('HAR toast fixture cleanup'))
          ipcMain.removeHandler('browser:copy-text')
          ipcMain.handle('browser:copy-text', original)
        }
      }
      ;(globalThis as HarToastProbe).harToastProbe = probe
      ipcMain.removeHandler('browser:copy-text')
      ipcMain.handle('browser:copy-text', (event, ...args) => {
        probe.calls += 1
        if (probe.calls === 1) return pending
        if (probe.failNext) { probe.failNext = false; throw new Error('Current HAR clipboard refusal') }
        return original(event, ...args)
      })
    })
    try {
      const copy = panel.locator('footer').getByRole('button', { name: /^(Copy sanitized HAR|Copied)$/ })
      await copy.click()
      await expect.poll(() => electronApp.evaluate(() => (globalThis as HarToastProbe).harToastProbe?.calls)).toBe(1)
      if (action === 'filter') await filter.fill('fixture=har-toast method:POST')
      else { await copy.click(); await expect(copy).toHaveText('Copied') }
      await electronApp.evaluate(() => { (globalThis as HarToastProbe).harToastProbe?.reject() })
      await appWindow.evaluate('window.hronaut.getState()')
      await appWindow.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())))
      expect(await appWindow.locator('.app-toast').filter({ hasText: 'Obsolete HAR clipboard refusal' }).count()).toBe(0)
      expect(await copy.innerText()).toBe(action === 'newer' ? 'Copied' : 'Copy sanitized HAR')
      await electronApp.evaluate(() => {
        const probe = (globalThis as HarToastProbe).harToastProbe
        if (probe) probe.failNext = true
      })
      await copy.click()
      await expect(appWindow.getByRole('alert').filter({ hasText: 'Current HAR clipboard refusal' })).toBeVisible()
      await expect(copy).toHaveText('Copy sanitized HAR')
    } finally {
      await electronApp.evaluate(() => {
        const scope = globalThis as HarToastProbe
        scope.harToastProbe?.restore()
        delete scope.harToastProbe
      })
    }
  })
}
