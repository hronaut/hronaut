import { createServer, type ServerResponse } from 'node:http'
import { readFile } from 'node:fs/promises'
import type { HronautApi, HronautDownloadsApi } from '../../src/shared/types.js'
import { closeFixtureServer, expect, test } from './fixtures.js'

type ShellWindow = typeof window & { hronaut: HronautApi; hronautDownloads: HronautDownloadsApi }

type FocusGate = { held: boolean; release(): void; restore(): void }
type ProbeGlobal = typeof globalThis & { downloadFocusGate?: FocusGate }

for (const scenario of ['Enter', 'Space', 'newer-focus', 'reopen'] as const) {
  test(`keeps download controls reachable with ${scenario}`, async ({ appWindow, electronApp }) => {
    const payload = Buffer.alloc(2 * 1024 * 1024, 'download-focus-fixture\n')
    const pending = new Map<ServerResponse, number>()
    let release = false
    const server = createServer((request, response) => {
      if (request.url !== '/file.bin') { response.end('<title>Download focus</title>'); return }
      const start = Number(/^bytes=(\d+)-/.exec(request.headers.range ?? '')?.[1] ?? 0)
      response.writeHead(start ? 206 : 200, {
        'content-type': 'application/octet-stream', 'content-disposition': 'attachment; filename="file.bin"',
        'content-length': payload.length - start, 'accept-ranges': 'bytes', etag: '"download-focus"',
        ...(start ? { 'content-range': `bytes ${start}-${payload.length - 1}/${payload.length}` } : {})
      })
      if (release) { response.end(payload.subarray(start)); return }
      const end = Math.min(payload.length, start + 256 * 1024)
      response.write(payload.subarray(start, end)); pending.set(response, end)
      response.once('close', () => pending.delete(response))
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    try {
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('Missing fixture server')
      const url = `http://127.0.0.1:${address.port}/`
      await appWindow.evaluate(url => (window as ShellWindow).hronaut.newTab({ url, active: true }), url)
      await expect.poll(() => electronApp.evaluate(({ webContents }, url) =>
        webContents.getAllWebContents().some(contents => contents.getURL() === url), url)).toBe(true)
      await electronApp.evaluate(({ webContents }, url) => {
        webContents.getAllWebContents().find(contents => contents.getURL() === url)!.downloadURL(`${url}file.bin`)
      }, url)
      await expect.poll(async () => ((await appWindow.evaluate(() => (window as ShellWindow).hronautDownloads.list()))[0]?.receivedBytes ?? 0)).toBeGreaterThan(0)
      const panel = appWindow.getByRole('dialog', { name: 'Downloads', exact: true })
      const pause = panel.getByRole('button', { name: 'Pause file.bin', exact: true })
      const resume = panel.getByRole('button', { name: 'Resume file.bin', exact: true })
      if (scenario === 'newer-focus' || scenario === 'reopen') {
        await electronApp.evaluate(({ ipcMain }) => {
          type Handler = (event: Electron.IpcMainInvokeEvent, ...args: unknown[]) => unknown
          const channel = 'downloads:pause'
          const original = (ipcMain as typeof ipcMain & { _invokeHandlers: Map<string, Handler> })._invokeHandlers.get(channel)!
          let release!: () => void
          const pending = new Promise<void>(resolve => { release = resolve })
          const gate: FocusGate = { held: false, release, restore: () => {
            release(); ipcMain.removeHandler(channel); ipcMain.handle(channel, original)
            delete (globalThis as ProbeGlobal).downloadFocusGate
          } }
          ;(globalThis as ProbeGlobal).downloadFocusGate = gate
          ipcMain.removeHandler(channel)
          ipcMain.handle(channel, async (event, ...args: unknown[]) => {
            const result = await original(event, ...args); gate.held = true
            await pending; return result
          })
        })
        await pause.focus(); await appWindow.keyboard.press('Enter')
        await expect.poll(() => electronApp.evaluate(() => (globalThis as ProbeGlobal).downloadFocusGate?.held)).toBe(true)
        if (scenario === 'reopen') {
          await panel.getByRole('button', { name: 'Close downloads' }).click()
          await appWindow.getByRole('button', { name: '1 download in progress', exact: true }).click()
        }
        const close = panel.getByRole('button', { name: 'Close downloads' })
        await close.focus()
        await electronApp.evaluate(() => (globalThis as ProbeGlobal).downloadFocusGate?.release())
        await expect(resume).toBeEnabled()
        await expect(close).toBeFocused()
        await resume.focus(); await appWindow.keyboard.press('Enter')
        await expect(pause).toBeFocused()
      } else {
        await pause.focus(); await appWindow.keyboard.press(scenario)
        await expect(resume).toBeFocused()
        await appWindow.keyboard.press(scenario)
        await expect(pause).toBeFocused()
      }
      release = true
      for (const [response, end] of pending) response.end(payload.subarray(end))
      await expect.poll(() => appWindow.evaluate(() => (window as ShellWindow).hronautDownloads.list())).toEqual([
        expect.objectContaining({ state: 'completed', paused: false, receivedBytes: payload.length })
      ])
      const [finished] = await appWindow.evaluate(() => (window as ShellWindow).hronautDownloads.list())
      expect(await readFile(finished!.savePath!)).toEqual(payload)
    } finally {
      await electronApp.evaluate(() => (globalThis as ProbeGlobal).downloadFocusGate?.restore())
      await appWindow.evaluate(async () => {
        for (const download of await (window as ShellWindow).hronautDownloads.list()) {
          if (download.state === 'progressing' || download.canResume) await (window as ShellWindow).hronautDownloads.cancel(download.id)
        }
      })
      await closeFixtureServer(server)
    }
  })
}
