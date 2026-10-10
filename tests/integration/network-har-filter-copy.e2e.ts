import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { BrowserNetworkHar } from '../../src/shared/types.js'
import { expect, test, text } from './capability-fixtures.js'

type HarFilterProbe = typeof globalThis & {
  harFilterProbe?: { waiting: boolean; copies: number; release(): void; restore(): void }
}

for (const phase of ['completed', 'pending'] as const) {
  test(`keeps HAR clipboard ownership with current filters after a ${phase} export`, async ({ capabilities, appWindow, electronApp }) => {
    const { client, tabId, openPageTool } = capabilities
    const retained = async () => {
      const result = await client.callTool({ name: 'browser_network', arguments: { tabId } }) as CallToolResult
      expect(result.isError, text(result)).not.toBe(true)
      return JSON.parse(text(result)) as Array<{ url: string; completedAt?: string }>
    }
    await retained()
    const fetched = await client.callTool({ name: 'browser_evaluate', arguments: {
      tabId, script: "Promise.all(['first','second'].map(marker => fetch('/api-details?fixture=har-filter-' + marker, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query: marker }) }).then(response => response.text()))).then(() => true)"
    } }) as CallToolResult
    expect(fetched.isError, text(fetched)).not.toBe(true)
    await expect.poll(async () => (await retained()).filter(entry => entry.url.includes('fixture=har-filter-') && entry.completedAt).length).toBe(2)
    await openPageTool('Open network monitor')
    const panel = appWindow.getByRole('dialog', { name: 'Network', exact: true })
    const filter = panel.getByRole('searchbox', { name: 'Filter network requests', exact: true })
    await filter.fill('fixture=har-filter-first')
    await expect(panel.getByRole('listbox', { name: 'Network requests' }).getByRole('option')).toHaveCount(1)
    await electronApp.evaluate(({ ipcMain, clipboard }, hold) => {
      type Handler = (event: Electron.IpcMainInvokeEvent, ...args: unknown[]) => unknown
      const handlers = (ipcMain as typeof ipcMain & { _invokeHandlers: Map<string, Handler> })._invokeHandlers
      const originals = ['browser:network-har', 'browser:copy-text'].map(channel => {
        const handler = handlers.get(channel)
        if (!handler) throw new Error(`Missing fixture handler: ${channel}`)
        return { channel, handler }
      })
      let release!: () => void
      const pending = new Promise<void>(resolve => { release = resolve })
      let exports = 0
      const probe = { waiting: false, copies: 0, release, restore: () => {
        release()
        for (const { channel, handler } of originals) {
          ipcMain.removeHandler(channel)
          ipcMain.handle(channel, handler)
        }
      } }
      ;(globalThis as HarFilterProbe).harFilterProbe = probe
      for (const { channel, handler } of originals) {
        ipcMain.removeHandler(channel)
        ipcMain.handle(channel, async (event, ...args) => {
          if (channel === 'browser:copy-text') { probe.copies += 1; return handler(event, ...args) }
          const result = await handler(event, ...args)
          if (++exports === 1 && hold) { probe.waiting = true; await pending }
          return result
        })
      }
      clipboard.writeText('HAR filter clipboard sentinel')
    }, phase === 'pending')
    try {
      const copy = panel.locator('footer').getByRole('button', { name: /^(Copy sanitized HAR|Copied)$/ })
      await copy.click()
      if (phase === 'pending') {
        await expect.poll(() => electronApp.evaluate(() => (globalThis as HarFilterProbe).harFilterProbe?.waiting)).toBe(true)
      } else await expect(copy).toHaveText('Copied')
      const previous = await electronApp.evaluate(({ clipboard }) => clipboard.readText())
      await filter.fill('fixture=har-filter-second')
      // Read immediately so expiry of an earlier success timer cannot hide stale feedback.
      expect(await copy.innerText()).toBe('Copy sanitized HAR')
      if (phase === 'pending') {
        await electronApp.evaluate(() => { (globalThis as HarFilterProbe).harFilterProbe?.release() })
        await appWindow.evaluate('window.hronaut.getState()')
        await appWindow.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())))
        expect(await electronApp.evaluate(() => (globalThis as HarFilterProbe).harFilterProbe?.copies)).toBe(0)
      }
      expect(await electronApp.evaluate(({ clipboard }) => clipboard.readText())).toBe(previous)
      await copy.click()
      await expect(copy).toHaveText('Copied')
      const har = JSON.parse(await electronApp.evaluate(({ clipboard }) => clipboard.readText())) as BrowserNetworkHar
      expect(har.log.entries).toHaveLength(1)
      expect(har.log.entries[0]!.request.url).toContain('fixture=har-filter-second')
      expect(har._hronaut.includesBodies).toBe(false)
      expect((await retained()).filter(entry => entry.url.includes('fixture=har-filter-'))).toHaveLength(2)
    } finally {
      await electronApp.evaluate(() => {
        const scope = globalThis as HarFilterProbe
        scope.harFilterProbe?.restore()
        delete scope.harFilterProbe
      })
    }
  })
}
