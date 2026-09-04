import { expect, test } from './fixtures.js'

test('finds page tools with keyboard search and readable cards in narrow and wide docks', async ({ appWindow, electronApp }, testInfo) => {
  await appWindow.getByRole('button', { name: 'New tab' }).click()
  await appWindow.getByRole('button', { name: 'Page tools', exact: true }).click()
  const panel = appWindow.getByRole('dialog', { name: 'Page tools', exact: true })
  const search = panel.getByRole('searchbox', { name: 'Search page tools' })
  await expect(panel.getByRole('status')).toHaveText('25 of 25 tools')

  await search.fill('  INDEXEDdb  ')
  await expect(panel.getByRole('status')).toHaveText('1 of 25 tools')
  await expect(panel.getByRole('button', { name: 'Site storage is unavailable' })).toBeDisabled()
  await search.press('ArrowDown')
  await expect(search).toBeFocused()
  await search.press('Escape')
  await expect(panel).toBeVisible()
  await expect(search).toHaveValue('')
  await search.fill('responsive')
  await search.press('ArrowDown')
  const responsive = panel.getByRole('button', { name: 'Responsive preview: Test phones, tablets, and desktops' })
  await expect(responsive).toBeFocused()
  await responsive.press('Enter')
  await expect(appWindow.getByRole('dialog', { name: 'Responsive preview' })).toBeVisible()
  await appWindow.getByRole('button', { name: 'Close responsive preview' }).click()
  await appWindow.getByRole('button', { name: 'Page tools', exact: true }).click()
  await expect(search).toHaveValue('')

  for (const theme of ['light', 'dark'] as const) {
    await appWindow.evaluate(`window.hronautSettings.setTheme('${theme}')`)
    await expect(appWindow.locator('html')).toHaveAttribute('data-theme', theme)
    for (const width of [1200, 760]) {
      await electronApp.evaluate(({ BrowserWindow }, value) => BrowserWindow.getAllWindows()[0]?.setSize(value, 760), width)
      await expect.poll(() => appWindow.evaluate(() => window.innerWidth)).toBe(width)
      for (const dock of ['right', 'bottom'] as const) {
        await panel.getByRole('combobox', { name: 'Dock page tools' }).selectOption(dock)
        const layout = await panel.evaluate((element) => {
          const cards = [...element.querySelectorAll<HTMLElement>('.page-tools-grid > button')]
          const text = [...element.querySelectorAll<HTMLElement>('.page-tools-grid strong, .page-tools-grid small')]
          return {
            overflow: element.scrollWidth - element.clientWidth,
            truncated: text.some((item) => item.scrollWidth > item.clientWidth + 1 || item.scrollHeight > item.clientHeight + 1),
            columns: getComputedStyle(element.querySelector('.page-tools-grid')!).gridTemplateColumns.split(' ').length,
            width: element.clientWidth,
            cards: cards.length,
            headingHeight: element.querySelector('h2')!.getBoundingClientRect().height,
            headingLineHeight: Number.parseFloat(getComputedStyle(element.querySelector('h2')!).lineHeight)
          }
        })
        expect(layout.overflow).toBeLessThanOrEqual(1)
        expect(layout.truncated).toBe(false)
        expect(layout.cards).toBe(25)
        expect(layout.headingHeight).toBeLessThanOrEqual(layout.headingLineHeight + 1)
        if (layout.width < 510) expect(layout.columns).toBe(1)
        if (layout.width >= 760) expect(layout.columns).toBeGreaterThan(1)
        await appWindow.screenshot({ path: testInfo.outputPath(`page-tools-${theme}-${width}-${dock}.png`) })
      }
    }
  }
  await search.fill('does-not-exist')
  await expect(panel.getByRole('heading', { name: 'No matching tools' })).toBeVisible()
  const clearEmptySearch = panel.getByRole('button', { name: 'Clear search', exact: true }).last()
  expect((await clearEmptySearch.boundingBox())!.height).toBeGreaterThanOrEqual(32)
  await appWindow.screenshot({ path: testInfo.outputPath('page-tools-empty.png') })
  await clearEmptySearch.click()
  await expect(search).toBeFocused()
  await expect(panel.getByRole('status')).toHaveText('25 of 25 tools')
})
