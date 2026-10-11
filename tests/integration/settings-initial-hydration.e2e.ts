import type { BrowserState } from '../../src/shared/types.js'
import { expect, test } from './fixtures.js'

type Gate = { entered: boolean; returned: boolean; release(): void; restore(): void }
type Scope = typeof globalThis & { __settingsHydration?: Gate }

for (const late of [false, true]) {
  test(`preserves Settings through initial hydration after click: ${late}`, async ({ appWindow, electronApp }, testInfo) => {
    const initial = await appWindow.evaluate("window.hronaut.newTab({url:'about:blank'})") as BrowserState
    const initialTabId = initial.activeTabId!
    await electronApp.evaluate(({ BrowserWindow, ipcMain }) => {
      type Handler = (event: Electron.IpcMainInvokeEvent) => unknown
      const handlers = (ipcMain as typeof ipcMain & { _invokeHandlers: Map<string, Handler> })._invokeHandlers
      const original = handlers.get('browser:get-state')!
      const contents = BrowserWindow.getAllWindows()[0]!.webContents
      const send = contents.send
      let release!: () => void
      let released = false
      const barrier = new Promise<void>(resolve => { release = () => { released = true; resolve() } })
      const gate: Gate = { entered: false, returned: false, release, restore: () => {
        contents.send = send
        ipcMain.removeHandler('browser:get-state')
        ipcMain.handle('browser:get-state', original)
      } }
      ;(globalThis as Scope).__settingsHydration = gate
      contents.send = function (channel, ...args) {
        if (channel === 'browser:state-changed' && !released) return
        return send.call(this, channel, ...args)
      }
      ipcMain.removeHandler('browser:get-state')
      ipcMain.handle('browser:get-state', async event => {
        const state = await original(event)
        gate.entered = true
        await barrier
        gate.returned = true
        return state
      })
    })
    try {
      // Reinitialize the real renderer store, retaining the actual native state.
      await appWindow.reload({ waitUntil: 'domcontentloaded' })
      await expect.poll(() => electronApp.evaluate(() => (globalThis as Scope).__settingsHydration!.entered)).toBe(true)
      await appWindow.evaluate(() => {
        const scope = window as unknown as { __settingsProbe: { events: unknown[]; document: Document; observer: MutationObserver } }
        const events: unknown[] = []
        const observe = () => {
          if (events.length < 40) events.push({ time: performance.now(), panel: !!document.querySelector('#settings-page'), pressed: document.querySelector('.settings-button')?.getAttribute('aria-pressed'), home: document.querySelector('.app-home-button')?.getAttribute('aria-current') })
        }
        const observer = new MutationObserver(observe)
        observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['aria-pressed', 'aria-current'] })
        scope.__settingsProbe = { events, document, observer }
        observe()
      })
      const release = () => electronApp.evaluate(() => (globalThis as Scope).__settingsHydration!.release())
      const home = appWindow.getByRole('button', { name: 'Open Hronaut Home', exact: true })
      if (!late) { await release(); await expect(appWindow.locator(`[data-tab-id="${initialTabId}"]`)).toBeVisible() }
      await appWindow.getByRole('button', { name: 'Settings', exact: true }).click()
      const panel = appWindow.getByRole('tabpanel', { name: 'Settings', exact: true })
      await expect(panel).toBeVisible()
      if (late) {
        await release()
        await expect(appWindow.locator(`[data-tab-id="${initialTabId}"]`)).toBeVisible()
        await expect(panel).toBeVisible()
      }
      const beforeTheme = await panel.count()
      await appWindow.evaluate("window.hronautSettings.setTheme('dark')")
      await expect(appWindow.locator('html')).toHaveAttribute('data-theme', 'dark')
      await electronApp.evaluate(({ BrowserWindow }) => {
        const window = BrowserWindow.getAllWindows()[0]!
        window.setMinimumSize(600, 600)
        window.setSize(640, 800)
      })
      await expect.poll(() => appWindow.evaluate(() => window.innerWidth)).toBe(640)
      await expect.poll(() => panel.evaluate(element => {
        const bounds = element.getBoundingClientRect()
        const style = getComputedStyle(document.querySelector('.shell')!)
        const x = Math.round(Number.parseFloat(style.getPropertyValue('--tab-rail-width')) || 0)
        const y = Math.round(Number.parseFloat(style.getPropertyValue('--shell-content-top')) || 0)
        return { x: Math.round(bounds.x) - x, y: Math.round(bounds.y) - y, width: Math.round(bounds.width) - (window.innerWidth - x), height: Math.round(bounds.height) - (window.innerHeight - y) }
      })).toEqual({ x: 0, y: 0, width: 0, height: 0 })
      const observation = await appWindow.evaluate(() => {
        const probe = (window as unknown as { __settingsProbe: { events: unknown[]; document: Document; observer: MutationObserver } }).__settingsProbe
        probe.observer.disconnect()
        return { events: probe.events, sameDocument: document === probe.document, panels: document.querySelectorAll('#settings-page').length }
      })
      await testInfo.attach('settings-hydration-observation', { body: JSON.stringify({ late, beforeTheme, ...observation }), contentType: 'application/json' })
      expect(observation.sameDocument).toBe(true)
      expect(observation.panels).toBe(1)
      await home.click()
      await expect(panel).toHaveCount(0)
      await expect(home).toHaveAttribute('aria-current', 'page')
      await appWindow.getByRole('button', { name: 'Settings', exact: true }).click()
      await expect(panel).toBeVisible()
      await appWindow.locator(`[data-tab-id="${initialTabId}"]`).click()
      await expect(panel).toHaveCount(0)
      await appWindow.getByRole('button', { name: 'Settings', exact: true }).click()
      await expect(panel).toBeVisible()
      await appWindow.keyboard.press('Control+t')
      await expect(panel).toHaveCount(0)
    } finally {
      await electronApp.evaluate(() => { const gate = (globalThis as Scope).__settingsHydration; gate?.release(); gate?.restore(); delete (globalThis as Scope).__settingsHydration }).catch(() => undefined)
    }
  })
}
