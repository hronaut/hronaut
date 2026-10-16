import type { ElectronApplication, Page } from '@playwright/test'
import { BROWSER_TAB_GROUP_COLOR_HEX } from '../../src/shared/tab-groups.js'
import type { BrowserState } from '../../src/shared/types.js'
import { expect, test } from './fixtures.js'

type Rgb = { r: number; g: number; b: number }

function hexRgb(hex: string): Rgb {
  const [r, g, b] = [1, 3, 5].map(index => Number.parseInt(hex.slice(index, index + 2), 16))
  return { r: r!, g: g!, b: b! }
}

/** The pixel the window shows at a shell point, read from the composed frame. */
async function windowPixel(electronApp: ElectronApplication, x: number, y: number): Promise<Rgb> {
  return electronApp.evaluate(async ({ BrowserWindow }, point) => {
    const win = BrowserWindow.getAllWindows()[0]!
    const image = await win.webContents.capturePage()
    const scale = image.getSize().width / win.getContentBounds().width
    const [b, g, r] = image.crop({ x: Math.round(point.x * scale), y: Math.round(point.y * scale), width: 1, height: 1 }).toBitmap()
    return { r: r!, g: g!, b: b! }
  }, { x, y })
}

async function createWorkspace(page: Page, name: string, color: string): Promise<string> {
  const next = await page.evaluate<BrowserState>(`window.hronaut.createWorkspace(${JSON.stringify({ name, color, storage: 'scratch' })})`)
  return next.mcpTabGroups.find(group => group.name === name)!.id
}

async function rootTint(page: Page): Promise<string> {
  return page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--workspace-tint').trim())
}

test('washes the shell in the color of the workspace in view and crossfades between workspaces', async ({ appWindow, electronApp }, testInfo) => {
  await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1440, 900))
  await appWindow.evaluate(`window.hronautSettings.setTabPosition('left')`)
  await appWindow.evaluate(`window.hronautSettings.setTheme('light')`)
  await expect(appWindow.locator('html')).toHaveAttribute('data-theme', 'light')

  // The wash is strongest in the shell's top-left corner, on the rail's own surface.
  const probe = await appWindow.locator('.topbar').evaluate(element => {
    const rect = element.getBoundingClientRect()
    return { x: Math.round(rect.left + 2), y: Math.round(rect.top + 2) }
  })
  const neutral = hexRgb(await appWindow.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--shell-bottom').trim()))
  const green = hexRgb(BROWSER_TAB_GROUP_COLOR_HEX.green)
  await expect.poll(() => windowPixel(electronApp, probe.x, probe.y)).toEqual(neutral)

  const acme = await createWorkspace(appWindow, 'Acme', 'green')
  await appWindow.evaluate(`window.hronaut.newTab(${JSON.stringify({ mcpGroupId: acme, url: 'data:text/html,<title>Checkout</title><body style="margin:0;background:white">', active: true })})`)
  await expect.poll(() => rootTint(appWindow)).toBe('rgb(101, 168, 67)')
  // Strongest point: the theme's wash strength (about 13 percent) of the workspace color over the rail surface.
  const strength = Number.parseFloat(await appWindow.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--shell-wash-strength'))) / 100
  expect(strength).toBeGreaterThan(0.05)
  await expect.poll(async () => {
    const pixel = await windowPixel(electronApp, probe.x, probe.y)
    return (['r', 'g', 'b'] as const).every(channel => Math.abs(pixel[channel] - Math.round(green[channel] * strength + neutral[channel] * (1 - strength))) <= 4)
  }, { message: 'The rail takes the green workspace wash' }).toBe(true)
  await appWindow.screenshot({ path: testInfo.outputPath('workspace-green.png') })

  // The toolbar, the rail and the margin around the page share the wash; the page itself does not.
  const surfaces = await appWindow.evaluate(() => [document.querySelector('.toolbar')!, document.querySelector('.topbar')!, document.body]
    .map(element => getComputedStyle(element).backgroundImage))
  expect(surfaces.every(image => image.includes('radial-gradient')), surfaces.join(' | ')).toBe(true)
  // So do the bars that open under the toolbar.
  await appWindow.getByRole('button', { name: 'Find in page', exact: true }).click()
  await expect(appWindow.locator('.find-bar')).toBeVisible()
  expect(await appWindow.locator('.find-bar').evaluate(element => getComputedStyle(element).backgroundImage)).toContain('radial-gradient')
  await appWindow.keyboard.press('Escape')
  await expect(appWindow.locator('.find-bar')).toBeHidden()

  // Switching workspaces runs a transition on the registered color instead of jumping.
  await appWindow.evaluate(() => {
    const names: string[] = []
    document.documentElement.addEventListener('transitionrun', event => names.push(event.propertyName))
    ;(window as unknown as { __tintTransitions: string[] }).__tintTransitions = names
  })
  const northwind = await createWorkspace(appWindow, 'Northwind', 'purple')
  await appWindow.evaluate(`window.hronaut.newTab(${JSON.stringify({ mcpGroupId: northwind, url: 'data:text/html,<title>Admin</title><body style="margin:0;background:white">', active: true })})`)
  await expect.poll(() => appWindow.evaluate(() => (window as unknown as { __tintTransitions: string[] }).__tintTransitions))
    .toContain('--workspace-tint')
  await expect.poll(() => rootTint(appWindow)).toBe('rgb(139, 124, 246)')
  await appWindow.screenshot({ path: testInfo.outputPath('workspace-purple.png') })

  // Home is neutral again.
  await appWindow.getByRole('button', { name: 'Open Hronaut Home', exact: true }).click()
  await expect.poll(() => rootTint(appWindow)).toBe('rgba(0, 0, 0, 0)')
  await expect.poll(() => windowPixel(electronApp, probe.x, probe.y)).toEqual(neutral)
})
