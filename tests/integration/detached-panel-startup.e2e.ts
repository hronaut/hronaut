import type { RendererSettingsState } from '../../src/shared/types.js'
import { expect, test } from './fixtures.js'

test('retains the latest detached panel request while renderer startup settings are pending', async ({ appWindow, electronApp }) => {
  await appWindow.getByRole('button', { name: 'New tab' }).click()
  const settings = await appWindow.evaluate<RendererSettingsState>('window.hronautSettings.getRendererState()')
  await electronApp.evaluate(({ ipcMain }, state) => {
    const control = { release: undefined as (() => void) | undefined }
    ;(globalThis as typeof globalThis & { __panelStartup?: typeof control }).__panelStartup = control
    ipcMain.removeHandler('settings:get-renderer-state')
    ipcMain.handle('settings:get-renderer-state', event => {
      if (!event.sender.getURL().includes('hronautPanel=')) return state
      return new Promise(resolve => { control.release = () => resolve(state) })
    })
  }, settings)
  try {
    await appWindow.evaluate("window.hronautPanelWindow.open('console')")
    await expect.poll(() => electronApp.evaluate(() => Boolean((globalThis as typeof globalThis & {
      __panelStartup?: { release?: () => void }
    }).__panelStartup?.release))).toBe(true)
    await appWindow.evaluate("window.hronautPanelWindow.open('network')")
    const detachedPage = electronApp.windows().find(page => page.url().includes('hronautPanel=console'))
    if (!detachedPage) throw new Error('Missing initial console panel window')
    await expect(detachedPage.locator('#app')).toBeEmpty()
    await electronApp.evaluate(() => (globalThis as typeof globalThis & {
      __panelStartup?: { release?: () => void }
    }).__panelStartup?.release?.())
    await expect(detachedPage).toHaveTitle('Network monitor — Hronaut')
    await expect(detachedPage.getByRole('dialog', { name: 'Network', exact: true })).toBeVisible()
    await expect.poll(() => electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(2)
  } finally {
    await electronApp.evaluate(({ ipcMain }, state) => {
      const mainGlobal = globalThis as typeof globalThis & { __panelStartup?: { release?: () => void } }
      mainGlobal.__panelStartup?.release?.()
      delete mainGlobal.__panelStartup
      ipcMain.removeHandler('settings:get-renderer-state')
      ipcMain.handle('settings:get-renderer-state', () => state)
    }, settings)
  }
})
