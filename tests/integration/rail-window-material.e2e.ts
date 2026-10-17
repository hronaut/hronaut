import type { HronautApi, RendererSettingsState } from '../../src/shared/types.js'
import { expect, settleShellMotion, test } from './fixtures.js'

type Pixel = [red: number, green: number, blue: number]

/**
 * On Linux main shows no material, so the window is painted magenta to stand in for one: whatever the shell leaves
 * clear shows it. With the rail on, only the rail lets it through.
 */
test('lets a window material show behind the tab rail only, and keeps the solid surface on Linux', async ({ appWindow, electronApp }) => {
  await electronApp.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0]!.setContentSize(1280, 800) })
  await appWindow.evaluate("window.hronautSettings.setTheme('light')")
  await appWindow.evaluate("window.hronautSettings.setTabPosition('left')")
  await appWindow.evaluate(async () => {
    const bridge = (window as unknown as { hronaut: HronautApi }).hronaut
    const state = await bridge.createWorkspace({ name: 'Shop', color: 'green', storage: 'scratch' })
    const shop = state.mcpTabGroups.find((group) => group.name === 'Shop')!.id
    await bridge.newTab({ mcpGroupId: shop, url: 'data:text/html,<title>Checkout</title><body style="background:white">Checkout</body>', active: true })
  })
  const rail = appWindow.getByRole('navigation', { name: 'Tab navigation' })
  await expect(rail).toBeVisible()
  await expect(appWindow.locator('.workspace-tab-section').first()).toBeVisible()
  // Linux keeps the theme's solid surface: main reports no material.
  const state = await appWindow.evaluate(() => (window as unknown as { hronautSettings: { getRendererState: () => Promise<RendererSettingsState> } })
    .hronautSettings.getRendererState())
  expect(state.windowMaterial ?? null).toBeNull()
  await expect(appWindow.locator('html')).not.toHaveAttribute('data-window-material')

  const railWidth = await rail.evaluate((element) => Math.round(element.getBoundingClientRect().width))
  const card = await appWindow.locator('.workspace-tab-section').first().evaluate((element) => {
    const rect = element.getBoundingClientRect()
    return { x: Math.round(rect.left + 12), y: Math.round(rect.top + rect.height / 2) }
  })
  const toolbar = await appWindow.locator('.toolbar').evaluate((element) => {
    const rect = element.getBoundingClientRect()
    // Bare toolbar, left of its first control.
    return { x: Math.round(rect.left + 5), y: Math.round(rect.top + rect.height / 2) }
  })
  const sample = async (points: Record<string, [number, number]>): Promise<Record<string, Pixel>> => {
    // The workspace's tint crossfades in when its tab opens, and the bars slide in.
    await settleShellMotion(appWindow)
    return electronApp.evaluate(async ({ BrowserWindow }, points) => {
      const window = BrowserWindow.getAllWindows()[0]!
      const image = await window.webContents.capturePage()
      const scale = image.getSize().width / window.getContentSize()[0]!
      const bitmap = image.toBitmap()
      const width = image.getSize().width
      return Object.fromEntries(Object.entries(points).map(([name, [x, y]]) => {
        const offset = (Math.round(y * scale) * width + Math.round(x * scale)) * 4
        // Bitmaps are BGRA.
        return [name, [bitmap[offset + 2]!, bitmap[offset + 1]!, bitmap[offset]!]]
      }))
    }, points)
  }
  const points: Record<string, [number, number]> = {
    railEmpty: [Math.round(railWidth / 2), 560],
    railTop: [Math.round(railWidth / 2), 14],
    groupCard: [card.x, card.y],
    toolbar: [toolbar.x, toolbar.y],
    besidePage: [1276, 600],
    belowPage: [railWidth + 400, 797]
  }
  // The light veil lets about a fifth of the material through.
  const magenta = ([red, green, blue]: Pixel): boolean => red - green > 30 && blue - green > 30

  await electronApp.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0]!.setBackgroundColor('#ff00ff') })
  // Without a material, nothing is clear.
  const solid = await sample(points)
  for (const [name, pixel] of Object.entries(solid)) expect(magenta(pixel), `${name} ${pixel.join(',')}`).toBe(false)

  // As main marks it on macOS and Windows 11: the rail and its title strip let the window through; group cards, the
  // toolbar and the space around the page stay solid.
  await appWindow.evaluate(() => { document.documentElement.dataset.windowMaterial = 'vibrancy' })
  const clear = await sample(points)
  expect(magenta(clear.railEmpty!), clear.railEmpty!.join(',')).toBe(true)
  // One veil from top to bottom: the title strip is as clear as the rest of the rail.
  expect(magenta(clear.railTop!), clear.railTop!.join(',')).toBe(true)
  for (const name of ['groupCard', 'toolbar', 'besidePage', 'belowPage']) {
    expect(magenta(clear[name]!), `${name} ${clear[name]!.join(',')}`).toBe(false)
    // The surface beside the rail is the one it had.
    for (const channel of [0, 1, 2]) expect(Math.abs(clear[name]![channel]! - solid[name]![channel]!), name).toBeLessThanOrEqual(3)
  }

  // Find opens beside the rail, like the toolbar, never across it.
  await appWindow.getByRole('button', { name: 'Find in page', exact: true }).click()
  const findBar = appWindow.locator('.find-bar')
  await expect(findBar).toBeVisible()
  const find = await findBar.evaluate((element) => {
    const rect = element.getBoundingClientRect()
    return { left: Math.round(rect.left), y: Math.round(rect.top + rect.height / 2) }
  })
  expect(find.left).toBe(railWidth)
  const withFind = await sample({ railBesideFind: [Math.round(railWidth / 2), find.y], findBar: [railWidth + 8, find.y] })
  expect(magenta(withFind.railBesideFind!), withFind.railBesideFind!.join(',')).toBe(true)
  expect(magenta(withFind.findBar!), withFind.findBar!.join(',')).toBe(false)
  await appWindow.keyboard.press('Escape')
  await expect(findBar).toBeHidden()

  // A rail opened over the page in a narrow window keeps its solid surface.
  await electronApp.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0]!.setContentSize(820, 640) })
  await expect(rail).toHaveClass(/rail-collapsed/)
  await rail.hover()
  await expect(rail).not.toHaveClass(/rail-collapsed/)
  const revealed = await sample({ rail: [140, 420] })
  expect(magenta(revealed.rail!), revealed.rail!.join(',')).toBe(false)
})
