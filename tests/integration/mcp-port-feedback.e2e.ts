import type { HronautSettingsApi } from '../../src/shared/types.js'
import { expect, test } from './fixtures.js'

type Gate = { calls: number; release(): void; restore(): void }
type Scope = typeof globalThis & { __portFeedback?: Gate }

for (const action of ['move', 'reset'] as const) {
  for (const edited of action === 'move' ? [false, true] : [false]) {
    test(`MCP ${action} failure feedback belongs to its submitted draft (edited: ${edited})`, async ({ appWindow, electronApp }) => {
      const channel = action === 'move' ? 'settings:set-mcp-port' : 'settings:reset-mcp'
      const before = await appWindow.evaluate(() => (window as unknown as { hronautSettings: HronautSettingsApi }).hronautSettings.get())
      await electronApp.evaluate(({ ipcMain }, channel) => {
        type Handler = (event: Electron.IpcMainInvokeEvent, ...args: unknown[]) => unknown
        const handlers = (ipcMain as typeof ipcMain & { _invokeHandlers: Map<string, Handler> })._invokeHandlers
        const original = handlers.get(channel)!
        let release!: () => void
        const barrier = new Promise<void>(resolve => { release = resolve })
        const gate: Gate = { calls: 0, release, restore: () => {
          release()
          ipcMain.removeHandler(channel)
          ipcMain.handle(channel, original)
        } }
        ;(globalThis as Scope).__portFeedback = gate
        ipcMain.removeHandler(channel)
        ipcMain.handle(channel, async () => {
          gate.calls++
          await barrier
          throw new Error('Submitted port unavailable for feedback regression')
        })
      }, channel)
      try {
        await appWindow.getByRole('button', { name: 'Settings', exact: true }).click()
        await appWindow.getByRole('button', { name: /MCP security/ }).click()
        const port = appWindow.getByRole('spinbutton', { name: 'MCP server port' })
        await port.fill('49000')
        await appWindow.getByRole('button', { name: action === 'move' ? 'Apply port' : 'Reset to default', exact: true }).click()
        await expect.poll(() => electronApp.evaluate(() => (globalThis as Scope).__portFeedback!.calls)).toBe(1)
        await expect(appWindow.locator('.settings-layout')).toHaveJSProperty('inert', action === 'reset')
        const submitted = await port.inputValue()
        if (edited) {
          await port.fill('49001')
          await expect(port).toHaveValue('49001')
        }
        await electronApp.evaluate(() => (globalThis as Scope).__portFeedback!.release())
        await expect(appWindow.getByRole('button', { name: 'Apply port', exact: true })).toBeVisible()
        const status = appWindow.locator('.mcp-port-status')
        if (edited) {
          await expect(status).toHaveClass(/\bidle\b/)
          await expect(status).not.toContainText('Submitted port unavailable')
          await expect(appWindow.getByRole('button', { name: 'Apply port', exact: true })).toBeEnabled()
        } else {
          await expect(status).toHaveClass(/\berror\b/)
          await expect(status).toContainText('Submitted port unavailable')
        }
        await expect(port).toHaveValue(edited ? '49001' : submitted)
        expect(await electronApp.evaluate(() => (globalThis as Scope).__portFeedback!.calls)).toBe(1)
        const after = await appWindow.evaluate(() => (window as unknown as { hronautSettings: HronautSettingsApi }).hronautSettings.get())
        expect(after).toEqual(before)
      } finally {
        await electronApp.evaluate(() => { (globalThis as Scope).__portFeedback?.restore(); delete (globalThis as Scope).__portFeedback }).catch(() => undefined)
      }
    })
  }
}
