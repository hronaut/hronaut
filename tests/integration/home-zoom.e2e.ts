import type { ElectronApplication } from '@playwright/test'
import type { HronautApi } from '../../src/shared/types.js'
import { closeHronaut, expect, launchHronaut, test } from './fixtures.js'

const HOME_URL = 'hronaut://home/'

// Nothing zooms Hronaut Home: its keys, the zoom bar and the wheel leave it alone, and the View menu now does too. An
// older Hronaut's View menu zoomed it, and Electron keeps that zoom for Home's address in Home's session, so Home would
// have opened zoomed after every restart with no way left to reset it.
test('Home opens at 100% whatever zoom an older Hronaut stored for it, and the View menu leaves it there', async ({ profileDirectory, mcpPort }) => {
  const homeZoom = (app: ElectronApplication) => app.evaluate(({ webContents }, url) => (
    webContents.getAllWebContents().find((page) => page.getURL() === url)?.getZoomFactor()
  ), HOME_URL)
  let before: Awaited<ReturnType<typeof launchHronaut>> | undefined
  let after: Awaited<ReturnType<typeof launchHronaut>> | undefined
  try {
    before = await launchHronaut(profileDirectory, mcpPort)
    await expect.poll(() => homeZoom(before!.app), { timeout: 15_000 }).toBe(1)
    // In the shared zoom Home had before, a zoom is kept for Home's address.
    await before.app.evaluate(({ webContents }, url) => {
      const home = webContents.getAllWebContents().find((page) => page.getURL() === url)!
      home.setZoomMode('default')
      home.setZoomFactor(1.25)
    }, HOME_URL)
    await expect.poll(() => homeZoom(before!.app)).toBeCloseTo(1.25, 8)
    await closeHronaut(before.app)
    before = undefined

    after = await launchHronaut(profileDirectory, mcpPort)
    await expect.poll(() => homeZoom(after!.app), { timeout: 15_000 }).toBe(1)
    const shown = await after.window.evaluate(() => (window as unknown as { hronaut: HronautApi }).hronaut.getState())
    expect(shown.tabs.find((tab) => tab.id === shown.activeTabId)?.url).toBe(HOME_URL)

    for (const label of ['Zoom In', 'Actual Size', 'Zoom Out']) {
      await after.app.evaluate(({ BrowserWindow, Menu }, label) => {
        const view = Menu.getApplicationMenu()?.items.find((item) => item.label === 'View')
        const item = view?.submenu?.items.find((candidate) => candidate.label === label)
        if (!item?.click) throw new Error(`Missing menu item: View → ${label}`)
        item.click(item, BrowserWindow.getAllWindows()[0], {} as Electron.KeyboardEvent)
      }, label)
    }
    // The menu's choices run in Hronaut's window, which leaves Home alone; give them the time a zoom would take.
    await after.window.waitForTimeout(500)
    expect(await homeZoom(after.app)).toBe(1)
  } finally {
    if (before) await closeHronaut(before.app)
    if (after) await closeHronaut(after.app)
  }
})
