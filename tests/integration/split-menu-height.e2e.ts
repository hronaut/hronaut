import { execFile } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { Locator } from '@playwright/test'
import { expect, test } from './fixtures.js'
import type { HronautApi } from '../../src/shared/types.js'
const exec = promisify(execFile)
for (const position of ['top', 'left']) for (const mode of ['candidates', 'controls']) {
  test(`minimum-height split ${mode} with ${position} tabs`, async ({ appWindow, electronApp }, testInfo) => {
    await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(760, 520))
    await appWindow.evaluate('window.hronautSettings.setInterfaceScale(1.25)')
    await appWindow.evaluate(`window.hronautSettings.setTabPosition('${position}')`)
    for (let index = 0; index < 13; index++) {
      await appWindow.evaluate(`window.hronaut.newTab({ url: 'data:text/html,<title>Candidate ${index}</title><h1>Live page</h1>', active: true })`)
    }
    const session = await appWindow.context().newCDPSession(appWindow)
    await session.send('Emulation.setFocusEmulationEnabled', { enabled: false })
    const click = async (locator: Locator) => {
      const bounds = (await locator.boundingBox())!
      const origin = await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.getContentBounds())
      await exec('python3', [join(process.cwd(), 'tests/integration/x11-input.py'), String(origin.x + Math.round((bounds.x + bounds.width / 2) * 1.25)), String(origin.y + Math.round((bounds.y + bounds.height / 2) * 1.25)), '--click'])
    }
    const toggle = appWindow.getByRole('button', { name: 'Split view', exact: true })
    const menu = appWindow.getByRole('dialog', { name: 'Split view' })
    const captureDesktop = async (name: string) => {
      const png = await electronApp.evaluate(async ({ desktopCapturer }) => {
        const [screen] = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1920, height: 1080 } })
        return screen!.thumbnail.toPNG().toString('base64')
      })
      await writeFile(testInfo.outputPath(name), Buffer.from(png, 'base64'))
    }
    await click(toggle)
    if (mode === 'controls') {
      await click(menu.locator('.split-candidate-list button').first())
      await expect(menu).toBeHidden()
      await click(toggle)
    }
    if (position === 'left') {
      await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.webContents.focus())
      await appWindow.locator('.app-home-button').focus()
      await expect(appWindow.locator('.topbar')).toHaveCSS('width', '280px')
    }
    const rect = (await menu.boundingBox())!
    expect(rect.x).toBeGreaterThanOrEqual(0)
    if (position === 'left') {
      const rail = (await appWindow.locator('.topbar').boundingBox())!
      expect(rect.x).toBeGreaterThanOrEqual(rail.x + rail.width)
    }
    expect(rect.y).toBeGreaterThanOrEqual(0)
    expect(rect.x + rect.width).toBeLessThanOrEqual(608)
    expect(rect.y + rect.height).toBeLessThanOrEqual(416)
    await captureDesktop('short-window-menu.png')
    if (mode === 'controls') {
      await click(menu.getByRole('button', { name: 'Exit split view' }))
      await expect(menu).toBeHidden()
      await expect.poll(() => appWindow.evaluate('window.hronaut.getState().then(state => state.splitView)')).toBeUndefined()
    } else {
      const list = menu.locator('.split-candidate-list')
      const last = list.getByRole('button', { name: /Candidate 11/ })
      for (let attempt = 0; attempt < 8; attempt++) {
        const bounds = (await menu.boundingBox())!
        const header = (await menu.locator('header').boundingBox())!
        const target = (await last.boundingBox())!
        if (target.y >= header.y + header.height && target.y + target.height <= bounds.y + bounds.height - 8) break
        const origin = await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.getContentBounds())
        const bodyY = (header.y + header.height + bounds.y + bounds.height) / 2
        await exec('python3', [join(process.cwd(), 'tests/integration/x11-input.py'), String(origin.x + Math.round((bounds.x + bounds.width / 2) * 1.25)), String(origin.y + Math.round(bodyY * 1.25)), '--wheel'])
      }
      const lastBounds = (await last.boundingBox())!
      const menuBounds = (await menu.boundingBox())!
      const headerBounds = (await menu.locator('header').boundingBox())!
      expect(lastBounds.y).toBeGreaterThanOrEqual(headerBounds.y + headerBounds.height)
      expect(lastBounds.y + lastBounds.height).toBeLessThanOrEqual(menuBounds.y + menuBounds.height - 8)
      await captureDesktop('short-window-menu-scrolled.png')
      await click(last)
      await expect(menu).toBeHidden()
      await expect.poll(() => appWindow.evaluate(() => {
        return (window as unknown as { hronaut: HronautApi }).hronaut.getState().then(state => state.tabs.find(tab => tab.id === state.splitView?.secondTabId)?.title)
      })).toBe('Candidate 11')
    }
  })
}
