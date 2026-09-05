import { RESOLVED_THEME_NAMES } from '../../src/shared/theme.js'
import { expect, test } from './fixtures.js'

test('renders the Hronaut app icon across themes and compact rail expansion', async ({ appWindow, electronApp }, testInfo) => {
  await appWindow.evaluate("window.hronautSettings.setTabPosition('left')")
  await appWindow.evaluate("window.hronaut.newTab({ url: 'data:text/html,<title>Brand fixture</title>', active: true })")
  const title = appWindow.locator('.shell-title-bar-surface.surface-rail')
  const icon = title.locator('img')
  for (const theme of RESOLVED_THEME_NAMES) {
    await appWindow.evaluate(`window.hronautSettings.setTheme('${theme}')`)
    await expect(icon).toBeVisible()
    await expect.poll(() => icon.evaluate(image => ({ loaded: (image as HTMLImageElement).complete, width: (image as HTMLImageElement).naturalWidth, height: (image as HTMLImageElement).naturalHeight }))).toEqual({ loaded: true, width: 64, height: 64 })
    expect(await icon.evaluate(image => ({ width: image.getBoundingClientRect().width, height: image.getBoundingClientRect().height, filter: getComputedStyle(image).filter, draggable: (image as HTMLImageElement).draggable })))
      .toEqual({ width: 24, height: 24, filter: 'none', draggable: false })
    await expect(title).toHaveCSS('-webkit-app-region', 'drag')
    await expect(appWindow.locator('.app-home-button')).toHaveCSS('-webkit-app-region', 'no-drag')
    if (theme === 'light' || theme === 'cyberpunk-turbo') await title.screenshot({ path: testInfo.outputPath(`title-brand-${theme}.png`) })
  }
  await appWindow.evaluate("window.hronautSettings.setTheme('cyberpunk-turbo')")
  await appWindow.evaluate('window.hronautSettings.setInterfaceScale(1.25)')
  await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(760, 520))
  await appWindow.mouse.move(700 / 1.25, 400 / 1.25)
  await appWindow.locator('input.address').focus()
  await expect(icon).not.toBeVisible()
  await appWindow.locator('.app-home-button').focus()
  await expect(icon).toBeVisible()
  const bounds = await icon.boundingBox()
  const panel = await title.boundingBox()
  expect(bounds!.x).toBeGreaterThanOrEqual(panel!.x)
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(panel!.x + panel!.width)
  await title.screenshot({ path: testInfo.outputPath('title-brand-compact-125.png') })
})
