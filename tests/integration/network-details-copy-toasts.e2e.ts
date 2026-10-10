import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { expect, test, text } from './capability-fixtures.js'

type DetailsToastProbe = typeof globalThis & {
  detailsToastProbe?: { calls: number; failNext: boolean; reject(): void; restore(): void }
}

for (const action of ['selection', 'newer'] as const) {
  test(`suppresses an obsolete detail clipboard failure toast after ${action} ownership changes`, async ({ capabilities, appWindow, electronApp }) => {
    const { client, tabId, openPageTool } = capabilities
    const retained = async () => {
      const result = await client.callTool({ name: 'browser_network', arguments: { tabId } }) as CallToolResult
      expect(result.isError, text(result)).not.toBe(true)
      return JSON.parse(text(result)) as Array<{ url: string; completedAt?: string }>
    }
    await retained()
    const fetched = await client.callTool({ name: 'browser_evaluate', arguments: {
      tabId, script: "Promise.all(['one', 'two'].map(item => fetch('/api-details?fixture=details-toast&item=' + item, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query: item }) }).then(response => response.text()))).then(() => true)"
    } }) as CallToolResult
    expect(fetched.isError, text(fetched)).not.toBe(true)
    await expect.poll(async () => (await retained()).filter(entry => entry.url.includes('fixture=details-toast') && entry.completedAt).length).toBe(2)
    await openPageTool('Open network monitor')
    const panel = appWindow.getByRole('dialog', { name: 'Network', exact: true })
    const filter = panel.getByRole('searchbox', { name: 'Filter network requests', exact: true })
    await filter.fill('fixture=details-toast')
    const rows = panel.getByRole('listbox', { name: 'Network requests' }).getByRole('option')
    await expect(rows).toHaveCount(2)
    await rows.first().click()
    const previousUrl = await panel.locator('.network-detail-url').innerText()
    const responseSection = panel.locator('summary').filter({ hasText: /^Response body/ }).locator('..')
    if (action === 'newer') await responseSection.locator('summary').click()
    await electronApp.evaluate(({ ipcMain }) => {
      type Handler = (event: Electron.IpcMainInvokeEvent, ...args: unknown[]) => unknown
      const handlers = (ipcMain as typeof ipcMain & { _invokeHandlers: Map<string, Handler> })._invokeHandlers
      const original = handlers.get('browser:copy-text')
      if (!original) throw new Error('Missing clipboard handler')
      let reject!: (error: Error) => void
      const pending = new Promise<void>((_resolve, fail) => { reject = fail })
      const probe = { calls: 0, failNext: false,
        reject: () => reject(new Error('Obsolete detail clipboard refusal')),
        restore: () => {
          reject(new Error('Detail toast fixture cleanup'))
          ipcMain.removeHandler('browser:copy-text')
          ipcMain.handle('browser:copy-text', original)
        }
      }
      ;(globalThis as DetailsToastProbe).detailsToastProbe = probe
      ipcMain.removeHandler('browser:copy-text')
      ipcMain.handle('browser:copy-text', (event, ...args) => {
        probe.calls += 1
        if (probe.calls === 1) return pending
        if (probe.failNext) { probe.failNext = false; throw new Error('Current detail clipboard refusal') }
        return original(event, ...args)
      })
    })
    try {
      const copy = action === 'selection'
        ? panel.getByRole('button', { name: /^(Copy sanitized URL|Copied URL)$/ })
        : responseSection.getByRole('button', { name: /^(Copy sanitized response body|Copied response body)$/ })
      await copy.click()
      await expect.poll(() => electronApp.evaluate(() => (globalThis as DetailsToastProbe).detailsToastProbe?.calls)).toBe(1)
      if (action === 'selection') {
        await rows.last().click()
        await expect(panel.locator('.network-detail-url')).not.toHaveText(previousUrl)
        await expect(copy).toBeEnabled()
      } else {
        await panel.getByRole('button', { name: 'Copy sanitized URL', exact: true }).click()
        await expect(panel.getByRole('button', { name: 'Copied URL', exact: true })).toBeVisible()
        expect(await electronApp.evaluate(({ clipboard }) => clipboard.readText())).toBe(previousUrl)
      }
      await electronApp.evaluate(() => { (globalThis as DetailsToastProbe).detailsToastProbe?.reject() })
      await appWindow.evaluate('window.hronaut.getState()')
      await appWindow.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())))
      expect(await appWindow.locator('.app-toast').filter({ hasText: 'Obsolete detail clipboard refusal' }).count()).toBe(0)
      expect((await copy.innerText()).trim()).toBe(action === 'newer' ? 'Copy sanitized response body' : 'Copy sanitized URL')
      if (action === 'newer') await expect(panel.getByRole('button', { name: 'Copied URL', exact: true })).toBeVisible()
      await electronApp.evaluate(() => {
        const probe = (globalThis as DetailsToastProbe).detailsToastProbe
        if (probe) probe.failNext = true
      })
      await copy.click()
      await expect(appWindow.getByRole('alert').filter({ hasText: 'Current detail clipboard refusal' })).toBeVisible()
      await expect(copy).toHaveText(action === 'newer' ? 'Copy sanitized response body' : 'Copy sanitized URL')
    } finally {
      await electronApp.evaluate(() => {
        const scope = globalThis as DetailsToastProbe
        scope.detailsToastProbe?.restore()
        delete scope.detailsToastProbe
      })
    }
  })
}
