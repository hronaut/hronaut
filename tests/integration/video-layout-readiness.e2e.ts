import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { BrowserVideoState } from '../../src/shared/video.js'
import type { HronautApi } from '../../src/shared/types.js'
import { expect, test, text } from './capability-fixtures.js'
import { waitForInitialVideoLayout } from './video-layout.js'

type Probe = typeof globalThis & { layoutGate?: { held: boolean; release(): void; restore(): void } }
for (const mode of ['without-readiness', 'with-readiness'] as const) test(`controlled recording layout transition: ${mode}`, async ({ capabilities, appWindow, electronApp }, info) => {
  const { client, tabId, fixtureUrl } = capabilities
  const video = async (action: string): Promise<BrowserVideoState> => {
    const result = await client.callTool({ name: 'browser_video', arguments: { tabId, action } }) as CallToolResult
    expect(result.isError, text(result)).not.toBe(true)
    return JSON.parse(text(result)) as BrowserVideoState
  }
  await appWindow.evaluate(() => (window as unknown as { hronaut: HronautApi }).hronaut.openHome())
  await expect(appWindow.getByRole('combobox', { name: 'Address', exact: true })).not.toBeVisible()
  await expect.poll(async () => {
    const bottom = await appWindow.locator('.shell').evaluate(e => e.getBoundingClientRect().bottom)
    return electronApp.evaluate(({ BrowserWindow, webContents }, bottom) => {
      const window = BrowserWindow.getAllWindows()[0]!
      const page = webContents.getAllWebContents().find(w => w.getURL().startsWith('hronaut://home'))
      const view = window.contentView.children.find(v => 'webContents' in v && v.webContents === page)
      return view?.getBounds().y === Math.ceil(Math.ceil(bottom) * window.webContents.getZoomFactor())
    }, bottom)
  }).toBe(true)
  const oldBottom = await appWindow.locator('.shell').evaluate(e => e.getBoundingClientRect().bottom)
  await electronApp.evaluate(({ ipcMain }, oldBottom) => {
    const channel = 'browser:toolbar-height'
    const listeners = ipcMain.listeners(channel)
    let pending: [Electron.IpcMainEvent, number] | undefined
    let released = false
    const forward = (event: Electron.IpcMainEvent, height: number) => listeners.forEach(listener => listener(event, height))
    const probe = { held: false, release: () => { released = true; if (pending) forward(...pending) }, restore: () => {
      probe.release(); ipcMain.removeAllListeners(channel); listeners.forEach(listener => ipcMain.on(channel, listener)); delete (globalThis as Probe).layoutGate
    } }
    ;(globalThis as Probe).layoutGate = probe
    ipcMain.removeAllListeners(channel)
    ipcMain.on(channel, (event, height: number) => {
      if (!released && height > oldBottom) { pending = [event, height]; probe.held = true; return }
      forward(event, height)
    })
  }, oldBottom)
  let readiness: Promise<void> | undefined
  try {
    await appWindow.evaluate(id => (window as unknown as { hronaut: HronautApi }).hronaut.selectTab(id), tabId)
    await expect.poll(() => electronApp.evaluate(() => (globalThis as Probe).layoutGate?.held)).toBe(true)
    let ready = false
    let observedMismatch = false
    readiness = mode === 'with-readiness' ? waitForInitialVideoLayout(appWindow, electronApp, fixtureUrl, matches => { observedMismatch ||= !matches }).then(() => { ready = true }) : undefined
    void readiness?.catch(() => undefined)
    if (readiness) await expect.poll(() => observedMismatch).toBe(true)
    const held = await electronApp.evaluate(({ BrowserWindow, webContents }, url) => {
      const window = BrowserWindow.getAllWindows()[0]!
      const page = webContents.getAllWebContents().find(w => w.getURL() === url)!
      return window.contentView.children.find(v => 'webContents' in v && v.webContents === page)!.getBounds()
    }, fixtureUrl)
    expect(held.y).toBe(Math.ceil(oldBottom))
    const renderedBottom = await appWindow.locator('.shell').evaluate(e => e.getBoundingClientRect().bottom)
    expect(renderedBottom).toBeGreaterThan(held.y)
    const before = await video(mode === 'without-readiness' ? 'start' : 'get')
    if (mode === 'without-readiness') expect(before.frameCount).toBe(1)
    else { expect(ready).toBe(false); expect(before.status).toBe('idle') }
    await electronApp.evaluate(() => (globalThis as Probe).layoutGate!.release())
    if (readiness) await readiness
    else await waitForInitialVideoLayout(appWindow, electronApp, fixtureUrl)
    if (mode === 'without-readiness') {
      await expect.poll(async () => (await video('get')).status).toBe('paused')
      expect((await video('get')).frameCount).toBe(1)
    } else {
      await video('start')
      await expect.poll(async () => (await video('get')).frameCount).toBeGreaterThanOrEqual(3)
      await video('stop')
    }
    await info.attach('controlled-layout', { body: JSON.stringify({ mode, held, renderedBottom, state: await video('get') }), contentType: 'application/json' })
  } finally {
    try { await electronApp.evaluate(() => (globalThis as Probe).layoutGate?.restore()) }
    finally {
      if (readiness) await Promise.allSettled([readiness])
      await video('clear')
    }
  }
})
