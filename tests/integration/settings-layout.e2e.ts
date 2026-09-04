import { writeFile } from 'node:fs/promises'
import { expect, test } from './fixtures.js'

test('keeps settings controls and dialog actions reachable across narrow and wide layouts', async ({ appWindow, electronApp }, testInfo) => {
  await appWindow.getByRole('button', { name: 'Settings', exact: true }).click()
  const dialog = appWindow.getByRole('dialog', { name: 'Settings', exact: true })
  const navigation = dialog.locator('.settings-sidebar')
  for (const theme of ['light', 'dark'] as const) {
    await appWindow.evaluate(`window.hronautSettings.setTheme('${theme}')`)
    await expect(appWindow.locator('html')).toHaveAttribute('data-theme', theme)
    for (const width of [1200, 760, 640]) {
      await electronApp.evaluate(({ BrowserWindow }, value) => {
        const window = BrowserWindow.getAllWindows()[0]!
        window.setMinimumSize(600, 600)
        window.setSize(value, 800)
      }, width)
      await expect.poll(() => appWindow.evaluate(() => window.innerWidth)).toBe(width)
      for (const index of [0, 2, 3, 4]) {
        const section = navigation.getByRole('button').nth(index)
        await section.click()
        await expect(section).toHaveAttribute('aria-current', 'page')
        const content = dialog.locator('.settings-content')
        await content.evaluate(element => { element.scrollTop = 0 })
        await appWindow.screenshot({ path: testInfo.outputPath(`settings-${theme}-${width}-${index}.png`) })
        expect(await content.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1)
        if (width === 760 && index === 4) {
          const row = content.locator('.settings-row:has(.setting-select-control)')
          const copy = await row.locator(':scope > span').first().boundingBox()
          const control = await row.locator('.setting-select-control').boundingBox()
          expect(control!.y, 'Narrow MCP controls should follow the explanation instead of squeezing it into a thin column').toBeGreaterThanOrEqual(copy!.y + copy!.height)
        }
        const close = dialog.locator('.settings-footer').getByRole('button', { name: 'Close', exact: true })
        await expect(close).toBeInViewport()
        for (const control of await content.locator('input:not([type=hidden]), select, button').all()) {
          if (!(await control.isVisible())) continue
          await control.scrollIntoViewIfNeeded()
          const bounds = await control.boundingBox()
          const viewport = await content.boundingBox()
          expect(bounds!.x).toBeGreaterThanOrEqual(viewport!.x)
          expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport!.x + viewport!.width + 1)
        }
      }
    }
  }
  await dialog.locator('.settings-footer').getByRole('button', { name: 'Close', exact: true }).click()
  await expect(dialog).not.toBeVisible()
})

test('keeps Close visible when Large interface size reduces the available Settings height', async ({ appWindow, electronApp }, testInfo) => {
  await appWindow.getByRole('button', { name: 'Settings', exact: true }).click()
  const dialog = appWindow.getByRole('dialog', { name: 'Settings', exact: true })
  await electronApp.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0]!
    window.setMinimumSize(600, 600)
    window.setSize(760, 600)
  })
  await appWindow.getByRole('combobox', { name: 'Interface size' }).selectOption('1.25')
  await expect.poll(() => appWindow.evaluate(() => window.innerHeight)).toBe(480)
  const close = dialog.locator('.settings-footer').getByRole('button', { name: 'Close', exact: true })
  const capture = await electronApp.evaluate(async ({ BrowserWindow }) => {
    const image = await BrowserWindow.getAllWindows()[0]!.webContents.capturePage()
    return image.toPNG().toString('base64')
  })
  await writeFile(testInfo.outputPath('settings-large-interface-short-window.png'), Buffer.from(capture, 'base64'))
  const dialogBounds = await dialog.boundingBox()
  const closeBounds = await close.boundingBox()
  expect(closeBounds!.y + closeBounds!.height, 'Close must remain inside the visible dialog at 125% interface size').toBeLessThanOrEqual(dialogBounds!.y + dialogBounds!.height)
  await expect(close).toBeInViewport({ ratio: 1 })
  await close.click()
  await expect(dialog).not.toBeVisible()
})
