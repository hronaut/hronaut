import { execFile } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { ElectronApplication } from '@playwright/test'
import type { AppUpdateState } from '../../src/shared/types.js'
import { closeHronaut, expect, launchHronaut, test } from './fixtures.js'

const execFileAsync = promisify(execFile)
const key = 'hronaut:vertical-tab-rail-width'

async function pageBounds(app: ElectronApplication) {
  return app.evaluate(({ BrowserWindow }) => {
    const main = BrowserWindow.getAllWindows()[0]!
    const view = main.contentView.children.find(view => 'webContents' in view && (view as Electron.WebContentsView).webContents.getTitle() === 'Rail resize fixture')!
    return { ...view.getBounds(), visible: view.getVisible() }
  })
}

for (const scale of [1, 1.25]) {
  test(`resizes the workspace rail across the native page at ${scale} scale`, async ({ appWindow, electronApp }, testInfo) => {
    await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1200, 800))
    await appWindow.evaluate(`window.hronautSettings.setInterfaceScale(${scale})`)
    await appWindow.evaluate(`window.hronautSettings.setTheme('${scale === 1.25 ? 'cyberpunk-turbo' : 'light'}')`)
    await appWindow.evaluate("window.hronautSettings.setTabPosition('left')")
    await appWindow.evaluate("window.hronaut.newTab({ url: 'data:text/html,<title>Rail resize fixture</title><h1>Live page beside the workspace panel</h1>', active: true })")
    const handle = appWindow.getByRole('separator', { name: 'Resize workspace panel', exact: true })
    await expect(handle).toHaveAttribute('aria-valuenow', '280')
    const start = (await handle.boundingBox())!
    await appWindow.mouse.move(start.x + 4, start.y + 140)
    await appWindow.mouse.down()
    await appWindow.mouse.move(start.x + 64, start.y + 140)
    await expect(handle).toHaveAttribute('aria-valuenow', '340')
    await expect.poll(() => pageBounds(electronApp)).toMatchObject({ x: Math.round(340 * scale), visible: true })
    expect(await appWindow.evaluate(key => localStorage.getItem(key), key)).toBeNull()
    await appWindow.mouse.up()
    await expect.poll(() => appWindow.evaluate(key => localStorage.getItem(key), key)).toBe('340')

    // Physical X11 input crosses from renderer chrome into a native
    // WebContentsView. Pointer capture must keep the drag with the separator.
    if (process.platform === 'linux') {
      const rect = (await handle.boundingBox())!
      const origin = await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.getContentBounds())
      const x = origin.x + Math.round((rect.x + 4) * scale)
      const y = origin.y + Math.round((rect.y + 140) * scale)
      await execFileAsync('python3', [join(process.cwd(), 'tests/integration/x11-input.py'), String(x), String(y), `--drag-to=${x + Math.round(100 * scale)},${y}`])
      await expect(handle).toHaveAttribute('aria-valuenow', '440')
      await expect(handle).not.toHaveClass(/active/)
    }
    const nativeImage = await electronApp.evaluate(async ({ BrowserWindow }) => {
      const view = BrowserWindow.getAllWindows()[0]!.contentView.children.find(view => 'webContents' in view && (view as Electron.WebContentsView).webContents.getTitle() === 'Rail resize fixture') as Electron.WebContentsView
      const heading = await view.webContents.executeJavaScript('document.querySelector("h1").getBoundingClientRect().height') as number
      if (heading <= 0) throw new Error('The live native page heading is not rendered')
      return (await view.webContents.capturePage()).toPNG().toString('base64')
    })
    await writeFile(testInfo.outputPath(`native-page-${scale}.png`), Buffer.from(nativeImage, 'base64'))
    await handle.focus()
    await handle.press('Home')
    await expect(handle).toHaveAttribute('aria-valuenow', '200')
    await handle.press('End')
    await expect(handle).toHaveAttribute('aria-valuenow', '480')
    await handle.press('Shift+ArrowLeft')
    await expect(handle).toHaveAttribute('aria-valuenow', '432')
    const beforeCancel = (await handle.boundingBox())!
    await appWindow.mouse.move(beforeCancel.x + 4, beforeCancel.y + 140)
    await appWindow.mouse.down()
    await appWindow.mouse.move(beforeCancel.x - 56, beforeCancel.y + 140)
    await expect(handle).toHaveAttribute('aria-valuenow', '372')
    await appWindow.keyboard.press('Escape')
    await appWindow.mouse.up()
    await expect(handle).toHaveAttribute('aria-valuenow', '432')
    expect(await appWindow.evaluate(key => localStorage.getItem(key), key)).toBe('432')

    // A smaller viewport clamps the display, while preserving the preferred
    // width for the next large window. Compact overlay content still reserves 56px.
    await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(760, 520))
    await expect.poll(() => appWindow.evaluate('innerWidth')).toBe(Math.round(760 / scale))
    await appWindow.locator('.app-home-button').focus()
    const maximum = Math.min(480, Math.round(760 / scale) - 320)
    await expect(handle).toHaveAttribute('aria-valuemax', String(maximum))
    await expect(handle).toHaveAttribute('aria-valuenow', String(Math.min(432, maximum)))
    await expect.poll(() => pageBounds(electronApp)).toMatchObject({ x: Math.round(56 * scale), visible: true })
    expect(await appWindow.evaluate(key => localStorage.getItem(key), key)).toBe('432')
    await handle.focus()
    await handle.press('Home')
    await appWindow.evaluate("window.hronautSettings.setLanguagePreference('de-DE')")
    await appWindow.locator('.app-home-button').focus()
    await expect(appWindow.locator('.tab-rail-resize-handle')).toHaveAttribute('aria-valuenow', '200')
    await electronApp.evaluate(({ BrowserWindow, app }) => BrowserWindow.getAllWindows()[0]!.webContents.send('updates:changed', {
      status: 'available', currentVersion: app.getVersion(), availableVersion: '99.0.0'
    } satisfies AppUpdateState))
    await expect(appWindow.locator('.update-status-pill')).toBeVisible()
    const actions = await appWindow.locator('.topbar-actions').evaluate(element => [...element.querySelectorAll('button')].filter(button => button.getBoundingClientRect().width > 0).map(button => {
      const rect = button.getBoundingClientRect()
      const range = document.createRange()
      range.selectNodeContents(button)
      const text = range.getBoundingClientRect()
      return { name: button.getAttribute('aria-label') || button.textContent, fits: rect.left >= 0 && rect.right <= 200 && text.top >= rect.top - 1 && text.bottom <= rect.bottom + 1 }
    }))
    expect(actions.every(action => action.fits), JSON.stringify(actions)).toBe(true)
    await appWindow.evaluate(() => Promise.all(document.getAnimations().filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => undefined))))
    const image = await electronApp.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0]!.capturePage()).toPNG().toString('base64'))
    await writeFile(testInfo.outputPath(`rail-200-${scale}.png`), Buffer.from(image, 'base64'))
    await appWindow.locator('.tab-rail-resize-handle').dblclick()
    expect(await appWindow.evaluate(key => localStorage.getItem(key), key)).toBeNull()
    await expect(appWindow.locator('.tab-rail-resize-handle')).toHaveAttribute('aria-valuenow', '280')
  })
}

test('restores the preferred workspace width after restarting Hronaut', async ({ profileDirectory, mcpPort }) => {
  const first = await launchHronaut(profileDirectory, mcpPort)
  let second: Awaited<ReturnType<typeof launchHronaut>> | undefined
  try {
    await first.window.evaluate("window.hronautSettings.setTabPosition('left')")
    await first.window.evaluate("window.hronaut.newTab({ url: 'data:text/html,<title>Rail resize fixture</title><h1>Restart fixture</h1>', active: true })")
    const handle = first.window.getByRole('separator', { name: 'Resize workspace panel', exact: true })
    await handle.focus()
    await handle.press('Shift+ArrowRight')
    await handle.press('Shift+ArrowRight')
    await expect(handle).toHaveAttribute('aria-valuenow', '376')
    await closeHronaut(first.app)
    second = await launchHronaut(profileDirectory, mcpPort)
    const restored = second.window.getByRole('separator', { name: 'Resize workspace panel', exact: true })
    await expect(restored).toHaveAttribute('aria-valuenow', '376')
    await expect(second.window.locator('.topbar')).toHaveCSS('width', '376px')
    await expect(second.window.locator('.tab').filter({ hasText: 'Rail resize fixture' })).toBeVisible()
    await second.window.evaluate(`(async () => {
      const state = await window.hronaut.getState()
      const tab = state.tabs.find(tab => tab.active)
      await window.hronaut.setAllHumanInteractionLocked(false)
      await window.hronaut.setTabHumanInteractionLocked(tab.id, false)
    })()`)
    await second.window.locator('.tab-rail-pin').click()
    await second.window.mouse.move(700, 500)
    await second.window.locator('input.address').focus()
    await expect(second.window.locator('.topbar')).toHaveCSS('width', '56px')
    // Playwright emulates document focus by default; use real native focus for this boundary check.
    const session = await second.window.context().newCDPSession(second.window)
    await session.send('Emulation.setFocusEmulationEnabled', { enabled: false })
    await second.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.webContents.focus())
    await second.window.locator('.app-home-button').focus()
    await expect(restored).toHaveAttribute('aria-valuenow', '376')
    const nativePoint = await second.app.evaluate(async ({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0]!
      const view = window.contentView.children.find(view => 'webContents' in view && (view as Electron.WebContentsView).webContents.getTitle() === 'Rail resize fixture') as Electron.WebContentsView
      await view.webContents.executeJavaScript('document.addEventListener("click", () => document.body.dataset.clicked = "yes")')
      const origin = window.getContentBounds()
      const bounds = view.getBounds()
      return { x: origin.x + bounds.x + bounds.width - 80, y: origin.y + bounds.y + 100 }
    })
    await execFileAsync('python3', [join(process.cwd(), 'tests/integration/x11-input.py'), String(nativePoint.x), String(nativePoint.y), '--click'])
    await expect.poll(() => second!.app.evaluate(async ({ BrowserWindow, webContents }) => {
      const view = BrowserWindow.getAllWindows()[0]!.contentView.children.find(view => 'webContents' in view && (view as Electron.WebContentsView).webContents.getTitle() === 'Rail resize fixture') as Electron.WebContentsView
      return { clicked: await view.webContents.executeJavaScript('document.body.dataset.clicked') as string, focused: webContents.getFocusedWebContents()?.id === view.webContents.id }
    })).toEqual({ clicked: 'yes', focused: true })
    await expect(second.window.locator('.topbar')).toHaveCSS('width', '56px')
  } finally {
    if (second) await closeHronaut(second.app)
    else await closeHronaut(first.app)
  }
})


test('keeps the workspace separator on the rail boundary for every panel dock', async ({ appWindow }) => {
  await appWindow.evaluate("window.hronautSettings.setTabPosition('left')")
  await appWindow.evaluate("window.hronaut.newTab({ url: 'data:text/html,<title>Rail resize fixture</title><h1>Dock fixture</h1>', active: true })")
  await appWindow.getByRole('button', { name: 'Page tools', exact: true }).click()
  const panel = appWindow.getByRole('dialog', { name: 'Page tools', exact: true })
  const handle = appWindow.getByRole('separator', { name: 'Resize workspace panel', exact: true })
  for (const dock of ['right', 'bottom', 'left', 'top']) {
    await panel.getByRole('combobox', { name: 'Dock page tools' }).selectOption(dock)
    await expect.poll(() => handle.evaluate(element => {
      const rail = element.closest('.topbar')!.getBoundingClientRect()
      const bounds = element.getBoundingClientRect()
      return { x: Math.round(bounds.right - rail.right), width: bounds.width, height: bounds.height > 300,
        hit: element.contains(document.elementFromPoint(bounds.x + 4, bounds.y + 80)), cursor: getComputedStyle(element).cursor }
    })).toEqual({ x: -1, width: 8, height: true, hit: true, cursor: 'col-resize' })
    const before = Number(await handle.getAttribute('aria-valuenow'))
    await handle.focus()
    await handle.press('ArrowRight')
    await expect(handle).toHaveAttribute('aria-valuenow', String(before + 16))
  }
})
