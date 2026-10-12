import type { HronautSettingsApi } from '../../src/shared/types.js'
import { expect, test } from './fixtures.js'

type Gate = { calls: number; committed: boolean; release(): void; restore(): void }
type Scope = typeof globalThis & { __downloadModeFeedback?: Gate }

for (const requested of [true, false]) {
  test(`download mode completion reflects a newer authoritative setting (requested: ${requested})`, async ({ appWindow, electronApp }) => {
    await appWindow.evaluate(enabled => (
      window as unknown as { hronautSettings: HronautSettingsApi }
    ).hronautSettings.setAskWhereToSaveDownloads(enabled), !requested)
    await electronApp.evaluate(({ ipcMain }) => {
      const channel = 'settings:set-ask-where-to-save-downloads'
      type Handler = (event: Electron.IpcMainInvokeEvent, ...args: unknown[]) => unknown
      const original = (ipcMain as typeof ipcMain & { _invokeHandlers: Map<string, Handler> })._invokeHandlers.get(channel)!
      let release!: () => void
      const barrier = new Promise<void>(resolve => { release = resolve })
      const gate: Gate = { calls: 0, committed: false, release, restore: () => {
        release()
        ipcMain.removeHandler(channel)
        ipcMain.handle(channel, original)
      } }
      ;(globalThis as Scope).__downloadModeFeedback = gate
      ipcMain.removeHandler(channel)
      ipcMain.handle(channel, async (event, ...args) => {
        const first = ++gate.calls === 1
        const result = await original(event, ...args)
        if (first) {
          gate.committed = true
          await barrier
        }
        return result
      })
    })
    try {
      await appWindow.getByRole('button', { name: 'Settings', exact: true }).click()
      await appWindow.getByRole('button', { name: 'Downloads Location and prompts' }).click()
      const checkbox = appWindow.getByRole('checkbox', { name: /^Ask where to save each file/ })
      await checkbox.setChecked(requested)
      await expect.poll(() => electronApp.evaluate(() => (globalThis as Scope).__downloadModeFeedback!.committed)).toBe(true)
      await expect(checkbox).toBeChecked({ checked: requested })
      await expect(checkbox).toBeDisabled()

      // Commit a second authoritative change through the real trusted settings
      // handler while only the first caller's response remains delayed.
      await appWindow.evaluate(enabled => (
        window as unknown as { hronautSettings: HronautSettingsApi }
      ).hronautSettings.setAskWhereToSaveDownloads(enabled), !requested)
      await expect(checkbox).toBeChecked({ checked: !requested })
      await electronApp.evaluate(() => (globalThis as Scope).__downloadModeFeedback!.release())

      const status = appWindow.locator('.download-settings-status')
      await expect(status).toHaveClass(/\bsaved\b/)
      await expect(status).toHaveText(requested
        ? 'New website downloads will save automatically.'
        : 'Hronaut will ask where to save each new website download.')
      await expect(checkbox).toBeChecked({ checked: !requested })
      await expect(checkbox).toBeEnabled()
      const settings = await appWindow.evaluate(() => (
        window as unknown as { hronautSettings: HronautSettingsApi }
      ).hronautSettings.get())
      expect(settings.askWhereToSaveDownloads).toBe(!requested)
      expect(await electronApp.evaluate(() => (globalThis as Scope).__downloadModeFeedback!.calls)).toBe(2)
    } finally {
      await electronApp.evaluate(() => {
        (globalThis as Scope).__downloadModeFeedback?.restore()
        delete (globalThis as Scope).__downloadModeFeedback
      }).catch(() => undefined)
    }
  })
}
