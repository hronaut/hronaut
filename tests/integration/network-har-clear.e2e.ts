import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { BrowserNetworkHar } from '../../src/shared/types.js'
import { expect, test, text } from './capability-fixtures.js'

type ClearProbe = { waiting: boolean; settled: boolean; copies: number; release(): void; restore(): void }
type ClearScope = typeof globalThis & { __harClear?: ClearProbe }

for (const phase of ['export', 'clipboard'] as const) for (const outcome of ['success', 'failure'] as const) {
  test(`Clear retires HAR ${phase} ${outcome} feedback`, async ({ capabilities, appWindow, electronApp }) => {
    const { client, tabId, openPageTool } = capabilities
    const retained = async () => {
      const result = await client.callTool({ name: 'browser_network', arguments: { tabId } }) as CallToolResult
      expect(result.isError, text(result)).not.toBe(true)
      return JSON.parse(text(result)) as Array<{ url: string; completedAt?: string }>
    }
    await retained()
    const fetchFixture = async (marker: string) => {
      const result = await client.callTool({ name: 'browser_evaluate', arguments: {
        tabId, script: `fetch('/api-details?har-clear=${marker}', {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({query:'${marker}'})}).then(r=>r.text()).then(()=>true)`
      } }) as CallToolResult
      expect(result.isError, text(result)).not.toBe(true)
      await expect.poll(async () => (await retained()).some(entry => entry.url.includes(`har-clear=${marker}`) && entry.completedAt)).toBe(true)
    }
    await fetchFixture('old')
    await openPageTool('Open network monitor')
    const panel = appWindow.getByRole('dialog', { name: 'Network', exact: true })
    const copy = panel.locator('footer').getByRole('button', { name: /^(Copy sanitized HAR|Copied)$/ })
    await electronApp.evaluate(({ ipcMain, clipboard }, { phase, outcome }) => {
      type Handler = (event: Electron.IpcMainInvokeEvent, ...args: unknown[]) => unknown
      const handlers = (ipcMain as typeof ipcMain & { _invokeHandlers: Map<string, Handler> })._invokeHandlers
      const originals = ['browser:network-har', 'browser:copy-text'].map(channel => ({ channel, handler: handlers.get(channel)! }))
      let release!: () => void
      const barrier = new Promise<void>(resolve => { release = resolve })
      const probe: ClearProbe = { waiting: false, settled: false, copies: 0, release, restore: () => {
        release()
        for (const { channel, handler } of originals) { ipcMain.removeHandler(channel); ipcMain.handle(channel, handler) }
      } }
      ;(globalThis as ClearScope).__harClear = probe
      for (const { channel, handler } of originals) {
        ipcMain.removeHandler(channel)
        ipcMain.handle(channel, async (event, ...args) => {
          if (channel === 'browser:copy-text') probe.copies++
          const result = await handler(event, ...args)
          if (!probe.waiting && channel === (phase === 'export' ? 'browser:network-har' : 'browser:copy-text')) {
            probe.waiting = true
            await barrier
            probe.settled = true
            if (outcome === 'failure') throw new Error('Controlled obsolete HAR reply failure')
          }
          return result
        })
      }
      clipboard.writeText('HAR Clear clipboard sentinel')
    }, { phase, outcome })
    try {
      await copy.click()
      await expect.poll(() => electronApp.evaluate(() => (globalThis as ClearScope).__harClear?.waiting)).toBe(true)
      const beforeClear = await electronApp.evaluate(({ clipboard }) => clipboard.readText())
      await panel.locator('footer').getByRole('button', { name: 'Clear', exact: true }).click()
      await expect(copy).toBeDisabled()
      await electronApp.evaluate(() => (globalThis as ClearScope).__harClear!.release())
      await expect.poll(() => electronApp.evaluate(() => (globalThis as ClearScope).__harClear?.settled)).toBe(true)
      await appWindow.evaluate('window.hronaut.getState()')
      await appWindow.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())))
      expect(await electronApp.evaluate(() => (globalThis as ClearScope).__harClear?.copies)).toBe(phase === 'export' ? 0 : 1)
      // Clearing cannot undo a clipboard write that already took place.
      expect(await electronApp.evaluate(({ clipboard }) => clipboard.readText())).toBe(beforeClear)
      expect(await copy.innerText()).toBe('Copy sanitized HAR')
      await expect(appWindow.getByText(/Controlled obsolete HAR reply failure/)).toHaveCount(0)
      await expect(panel.getByRole('alert')).toHaveCount(0)
      await fetchFixture('new')
      await panel.getByRole('button', { name: 'Refresh network requests', exact: true }).click()
      await expect(copy).toBeEnabled()
      await copy.click()
      await expect(copy).toHaveText('Copied')
      const har = JSON.parse(await electronApp.evaluate(({ clipboard }) => clipboard.readText())) as BrowserNetworkHar
      expect(har.log.entries.some(entry => entry.request.url.includes('har-clear=new'))).toBe(true)
      expect(har.log.entries.some(entry => entry.request.url.includes('har-clear=old'))).toBe(false)
      expect(har._hronaut.includesBodies).toBe(false)
    } finally {
      await electronApp.evaluate(() => { (globalThis as ClearScope).__harClear?.restore(); delete (globalThis as ClearScope).__harClear }).catch(() => undefined)
    }
  })
}
