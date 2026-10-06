import type { ElectronApplication, Page } from '@playwright/test'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { BrowserVideoState } from '../../src/shared/video.js'
import { expect, test, text } from './capability-fixtures.js'

type Gate = { held: boolean; finished: boolean; release(): void; restore(): void }
type ProbeGlobal = typeof globalThis & { previewIdentityGate?: Gate }
type UrlProbe = Window & { previewIdentityUrls?: { created: string[]; revoked: string[]; restore(): void } }

async function gate(app: ElectronApplication, mode: 'poll' | 'bytes'): Promise<void> {
  await app.evaluate(({ ipcMain }, mode) => {
    type Handler = (event: Electron.IpcMainInvokeEvent, ...args: unknown[]) => unknown
    const channel = mode === 'poll' ? 'browser:video' : 'browser:video-preview'
    const original = (ipcMain as typeof ipcMain & { _invokeHandlers: Map<string, Handler> })._invokeHandlers.get(channel)!
    let release!: () => void
    const pending = new Promise<void>(resolve => { release = resolve })
    const probe: Gate = { held: false, finished: false, release, restore: () => {
      release(); ipcMain.removeHandler(channel); ipcMain.handle(channel, original)
      delete (globalThis as ProbeGlobal).previewIdentityGate
    } }
    ;(globalThis as ProbeGlobal).previewIdentityGate = probe
    ipcMain.removeHandler(channel)
    ipcMain.handle(channel, async (event, ...args: unknown[]) => {
      if (probe.held || (mode === 'poll' && (args[0] as { action?: string })?.action !== 'get')) return original(event, ...args)
      const bytes = mode === 'bytes' ? await original(event, ...args) : undefined
      probe.held = true
      await pending
      const result = mode === 'bytes' ? bytes : await original(event, ...args)
      probe.finished = true
      return result
    })
  }, mode)
}
async function trackUrls(page: Page): Promise<void> {
  await page.evaluate(() => {
    const create = URL.createObjectURL, revoke = URL.revokeObjectURL
    const probe = { created: [] as string[], revoked: [] as string[], restore: () => {
      URL.createObjectURL = create; URL.revokeObjectURL = revoke
      delete (window as UrlProbe).previewIdentityUrls
    } }
    ;(window as UrlProbe).previewIdentityUrls = probe
    URL.createObjectURL = blob => { const url = create.call(URL, blob); probe.created.push(url); return url }
    URL.revokeObjectURL = url => { probe.revoked.push(url); revoke.call(URL, url) }
  })
}

for (const change of ['edit', 'new', 'clear', 'unchanged'] as const) {
  test(`binds the visible preview to its source after ${change} between polls`, async ({ capabilities, appWindow, electronApp }) => {
    const { client, tabId, openPageTool } = capabilities
    const video = async (action: string, extra: Record<string, unknown> = {}): Promise<BrowserVideoState> => {
      const result = await client.callTool({ name: 'browser_video', arguments: { tabId, action, ...extra } }) as CallToolResult
      expect(result.isError, text(result)).not.toBe(true)
      return JSON.parse(text(result)) as BrowserVideoState
    }
    const record = async () => {
      await video('start')
      await expect.poll(async () => (await video('get')).frameCount).toBeGreaterThanOrEqual(3)
      return video('stop')
    }
    await record()
    await openPageTool('Video recorder')
    await trackUrls(appWindow)
    const panel = appWindow.getByRole('region', { name: 'Video recorder' })
    try {
      await panel.getByRole('button', { name: 'Preview video' }).click()
      const preview = panel.locator('video')
      await expect(preview).toBeVisible()
      await expect.poll(() => preview.evaluate((element: HTMLVideoElement) => element.readyState)).toBeGreaterThanOrEqual(2)
      const originalUrl = await preview.getAttribute('src')
      const original = await video('get')
      await gate(electronApp, 'poll')
      await expect.poll(() => electronApp.evaluate(() => (globalThis as ProbeGlobal).previewIdentityGate?.held)).toBe(true)
      if (change === 'edit') {
        await video('edit', { annotations: [{ kind: 'text', text: 'Synthetic replacement', startMs: 0, endMs: original.durationMs }] })
        const replacement = await video('render')
        expect(replacement.previewReady).toBe(true)
        expect(replacement.timing!.revision).toBeGreaterThan(original.timing!.revision)
      } else if (change === 'new' || change === 'clear') {
        await video('clear')
        if (change === 'new') { expect((await record()).recordingId).not.toBe(original.recordingId); await video('render') }
      }
      await electronApp.evaluate(() => (globalThis as ProbeGlobal).previewIdentityGate?.release())
      await expect.poll(() => electronApp.evaluate(() => (globalThis as ProbeGlobal).previewIdentityGate?.finished)).toBe(true)
      if (change === 'unchanged') {
        await expect(preview).toHaveAttribute('src', originalUrl!)
        expect(await appWindow.evaluate(() => (window as UrlProbe).previewIdentityUrls!.revoked)).toEqual([])
        await appWindow.getByRole('button', { name: 'Close page tools' }).click()
        await expect.poll(() => appWindow.evaluate(() => (window as UrlProbe).previewIdentityUrls!.revoked)).toEqual([originalUrl])
        await appWindow.getByRole('button', { name: 'Page tools', exact: true }).click()
        await expect(panel).toBeVisible()
        await expect(panel.locator('video')).toHaveCount(0)
      } else {
        await expect(preview).toHaveCount(0)
        await expect.poll(() => appWindow.evaluate(() => (window as UrlProbe).previewIdentityUrls!.revoked)).toEqual([originalUrl])
      }
      expect(await appWindow.evaluate(() => (window as UrlProbe).previewIdentityUrls!.created.length)).toBe(1)
    } finally {
      await electronApp.evaluate(() => (globalThis as ProbeGlobal).previewIdentityGate?.restore())
      await video('clear')
      await appWindow.evaluate(() => (window as UrlProbe).previewIdentityUrls?.restore())
    }
  })
}

for (const change of ['edit', 'clear', 'close-reopen'] as const) {
  test(`discards delayed preview bytes after ${change}`, async ({ capabilities, appWindow, electronApp }) => {
    const { client, tabId, openPageTool } = capabilities
    const video = async (action: string, extra: Record<string, unknown> = {}): Promise<BrowserVideoState> => {
      const result = await client.callTool({ name: 'browser_video', arguments: { tabId, action, ...extra } }) as CallToolResult
      expect(result.isError, text(result)).not.toBe(true)
      return JSON.parse(text(result)) as BrowserVideoState
    }
    await video('start')
    await expect.poll(async () => (await video('get')).frameCount).toBeGreaterThanOrEqual(3)
    const source = await video('stop')
    await openPageTool('Video recorder')
    await trackUrls(appWindow)
    await gate(electronApp, 'bytes')
    const panel = appWindow.getByRole('region', { name: 'Video recorder' })
    try {
      await panel.getByRole('button', { name: 'Preview video' }).click()
      await expect.poll(() => electronApp.evaluate(() => (globalThis as ProbeGlobal).previewIdentityGate?.held)).toBe(true)
      if (change === 'edit') {
        await video('edit', { annotations: [{ kind: 'text', text: 'Synthetic newer clip', startMs: 0, endMs: source.durationMs }] })
        await video('render')
      } else if (change === 'clear') await video('clear')
      else {
        await appWindow.getByRole('button', { name: 'Close page tools' }).click()
        await expect(panel).toHaveCount(0)
        await appWindow.getByRole('button', { name: 'Page tools', exact: true }).click()
        await expect(panel).toBeVisible()
      }
      await electronApp.evaluate(() => (globalThis as ProbeGlobal).previewIdentityGate?.release())
      await expect.poll(() => electronApp.evaluate(() => (globalThis as ProbeGlobal).previewIdentityGate?.finished)).toBe(true)
      await expect(panel).toHaveAttribute('aria-busy', 'false')
      await expect(panel.locator('video')).toHaveCount(0)
      expect(await appWindow.evaluate(() => (window as UrlProbe).previewIdentityUrls!.created)).toEqual([])
    } finally {
      await electronApp.evaluate(() => (globalThis as ProbeGlobal).previewIdentityGate?.restore())
      await video('clear')
      await appWindow.evaluate(() => (window as UrlProbe).previewIdentityUrls?.restore())
    }
  })
}
