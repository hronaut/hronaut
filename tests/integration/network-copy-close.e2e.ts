import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { expect, test, text } from './capability-fixtures.js'

type CopyCloseGate = { waiting: boolean; settled: boolean; copies: number; release(): void; restore(): void }
type CopyCloseScope = typeof globalThis & { __networkCopyClose?: CopyCloseGate }
const cases = [
  { phase: 'export', kind: 'har', fail: false, reopen: false },
  { phase: 'export', kind: 'har', fail: false, reopen: true },
  ...['details', 'har'].flatMap(kind => [false, true].map(fail => ({ phase: 'clipboard', kind, fail, reopen: true })))
]

for (const { phase, kind, fail, reopen } of cases) {
  test(`Network close retires ${kind} ${phase} ${fail ? 'failure' : 'success'} (reopen=${reopen})`, async ({ capabilities, appWindow, electronApp }) => {
    const { client, tabId, openPageTool } = capabilities
    const retained = async () => {
      const result = await client.callTool({ name: 'browser_network', arguments: { tabId } }) as CallToolResult
      expect(result.isError, text(result)).not.toBe(true)
      return JSON.parse(text(result)) as Array<{ url: string; completedAt?: string }>
    }
    await retained()
    const fetched = await client.callTool({ name: 'browser_evaluate', arguments: { tabId, script: "fetch('/api-details?fixture=network-copy-close', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query: 'close-copy' }) }).then(response=>response.text()).then(()=>true)" } }) as CallToolResult
    expect(fetched.isError, text(fetched)).not.toBe(true)
    await expect.poll(async () => (await retained()).filter(row => row.url.includes('fixture=network-copy-close') && row.completedAt).length).toBe(1)
    await openPageTool('Open network monitor')
    const panel = appWindow.getByRole('dialog', { name: 'Network', exact: true })
    const filter = panel.getByRole('searchbox', { name: 'Filter network requests', exact: true })
    await filter.fill('fixture=network-copy-close')
    const rows = panel.getByRole('listbox', { name: 'Network requests' }).getByRole('option')
    await expect(rows).toHaveCount(1)
    await rows.first().click()
    const selectedUrl = await panel.locator('.network-detail-url').innerText()
    await electronApp.evaluate(({ ipcMain, clipboard }, { phase, fail }) => {
      type Handler = (event: Electron.IpcMainInvokeEvent, ...args: unknown[]) => unknown
      const handlers = (ipcMain as typeof ipcMain & { _invokeHandlers: Map<string, Handler> })._invokeHandlers
      const originals = ['browser:network-har', 'browser:copy-text'].map(channel => {
        const handler = handlers.get(channel)
        if (!handler) throw new Error('Missing Network copy fixture handler')
        return { channel, handler }
      })
      let release!: () => void
      const barrier = new Promise<void>(resolve => { release = resolve })
      let held = false
      const gate: CopyCloseGate = { waiting: false, settled: false, copies: 0, release, restore: () => {
        release()
        for (const { channel, handler } of originals) { ipcMain.removeHandler(channel); ipcMain.handle(channel, handler) }
      } }
      ;(globalThis as CopyCloseScope).__networkCopyClose = gate
      for (const { channel, handler } of originals) {
        ipcMain.removeHandler(channel)
        ipcMain.handle(channel, async (event, ...args) => {
          if (channel === 'browser:copy-text') gate.copies++
          const result = await handler(event, ...args)
          if (!held && channel === (phase === 'export' ? 'browser:network-har' : 'browser:copy-text')) {
            held = true; gate.waiting = true
            await barrier
            gate.settled = true
            if (fail) throw new Error('Closed Network clipboard reply failure')
          }
          return result
        })
      }
      clipboard.writeText('Network close clipboard sentinel')
    }, { phase, fail })
    try {
      const copy = kind === 'har'
        ? panel.locator('footer').getByRole('button', { name: /^(Copy sanitized HAR|Copied)$/ })
        : panel.getByRole('button', { name: /^(Copy sanitized URL|Copied URL)$/ })
      await copy.click()
      await expect.poll(() => electronApp.evaluate(() => (globalThis as CopyCloseScope).__networkCopyClose!.waiting)).toBe(true)
      const previous = await electronApp.evaluate(({ clipboard }) => clipboard.readText())
      if (phase === 'export') expect(previous).toBe('Network close clipboard sentinel')
      else if (kind === 'details') expect(previous).toBe(selectedUrl)
      else expect(JSON.parse(previous).log.entries).toHaveLength(1)
      await panel.locator('.panel-close').click()
      await expect(panel).toBeHidden()
      if (reopen) await openPageTool('Open network monitor')
      await electronApp.evaluate(() => (globalThis as CopyCloseScope).__networkCopyClose!.release())
      await expect.poll(() => electronApp.evaluate(() => (globalThis as CopyCloseScope).__networkCopyClose!.settled)).toBe(true)
      await appWindow.evaluate('window.hronaut.getState()')
      await appWindow.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())))
      expect(await appWindow.locator('.app-toast').filter({ hasText: 'Closed Network clipboard reply failure' }).count()).toBe(0)
      expect(await electronApp.evaluate(({ clipboard }) => clipboard.readText())).toBe(previous)
      expect(await electronApp.evaluate(() => (globalThis as CopyCloseScope).__networkCopyClose!.copies)).toBe(phase === 'export' ? 0 : 1)
      if (!reopen) await openPageTool('Open network monitor')
      expect((await copy.innerText()).trim()).toBe(kind === 'har' ? 'Copy sanitized HAR' : 'Copy sanitized URL')
      await expect(filter).toHaveValue('fixture=network-copy-close')
      await expect(rows).toHaveCount(1)
      await expect(panel.locator('.network-detail-url')).toHaveText(selectedUrl)
      await copy.click()
      await expect(copy).toHaveText(kind === 'har' ? 'Copied' : 'Copied URL')
    } finally {
      await electronApp.evaluate(() => { (globalThis as CopyCloseScope).__networkCopyClose?.restore(); delete (globalThis as CopyCloseScope).__networkCopyClose }).catch(() => undefined)
    }
  })
}
