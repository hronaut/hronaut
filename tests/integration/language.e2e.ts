import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { closeHronaut, expect, launchHronaut, test } from './fixtures.js'

test('switches language live through Settings and persists it across restart', async ({
  appWindow,
  electronApp,
  mcpPort,
  profileDirectory
}) => {
  await appWindow.getByRole('button', { name: 'Settings' }).click()
  const selector = appWindow.locator('#setting-language')
  await expect(selector).toHaveValue('system')
  await selector.selectOption('uk-UA')

  await expect(appWindow.locator('html')).toHaveAttribute('lang', 'uk-UA')
  await expect(appWindow.getByRole('heading', { name: 'Тема застосунку' })).toBeVisible()
  await expect(appWindow.getByRole('button', { name: 'Налаштування', exact: true })).toBeVisible()
  expect(await electronApp.evaluate(({ Menu }) => Menu.getApplicationMenu()?.items.map((item) => item.label))).toContain('Редагування')

  const detachedPromise = electronApp.waitForEvent('window')
  await appWindow.evaluate("window.hronautPanelWindow.open('console')")
  const detached = await detachedPromise
  await detached.waitForLoadState('domcontentloaded')
  await expect(detached.locator('html')).toHaveAttribute('lang', 'uk-UA')
  await expect.poll(() => detached.title()).toBe('Консоль — Hronaut')
  await appWindow.evaluate('window.hronautPanelWindow.close()')
  await expect.poll(async () => JSON.parse(await readFile(join(profileDirectory, 'settings.json'), 'utf8')).languagePreference).toBe('uk-UA')

  await closeHronaut(electronApp)
  const restarted = await launchHronaut(profileDirectory, mcpPort + 1)
  try {
    await expect(restarted.window.locator('html')).toHaveAttribute('lang', 'uk-UA')
    await restarted.window.getByRole('button', { name: 'Налаштування' }).click()
    await expect(restarted.window.locator('#setting-language')).toHaveValue('uk-UA')
  } finally {
    await closeHronaut(restarted.app)
  }
})

test('keeps a committed language change authoritative when the Home refresh fails', async ({
  appWindow,
  electronApp,
  profileDirectory
}) => {
  await appWindow.evaluate('window.hronaut.openHome()')
  await electronApp.evaluate(({ webContents }) => {
    const home = webContents.getAllWebContents().find((contents) => contents.getURL().startsWith('hronaut://home'))
    if (!home) throw new Error('Hronaut Home web contents was not found')
    Object.defineProperty(home, 'reload', {
      configurable: true,
      value: () => { throw new Error('Home refresh unavailable for language regression test') }
    })
  })

  await appWindow.getByRole('button', { name: 'Settings' }).click()
  const selector = appWindow.locator('#setting-language')
  await selector.selectOption('uk-UA')

  await expect(appWindow.locator('html')).toHaveAttribute('lang', 'uk-UA')
  await expect(selector).toHaveValue('uk-UA')
  await expect(appWindow.getByRole('heading', { name: 'Тема застосунку' })).toBeVisible()
  expect(await electronApp.evaluate(({ Menu }) => Menu.getApplicationMenu()?.items.map((item) => item.label))).toContain('Редагування')
  await expect
    .poll(async () => JSON.parse(await readFile(join(profileDirectory, 'settings.json'), 'utf8')).languagePreference)
    .toBe('uk-UA')
  await expect(appWindow.getByRole('alert')).toHaveCount(0)
})

test('supports Russian and the additional European language choices', async ({ appWindow }, testInfo) => {
  await appWindow.getByRole('button', { name: 'Settings' }).click()
  await appWindow.setViewportSize({ width: 760, height: 640 })
  const selector = appWindow.locator('#setting-language')
  await expect(selector.locator('option')).toHaveCount(8)

  const additionalHeadings = {
    'ru-RU': 'Тема приложения',
    'de-DE': 'Einstellungen',
    'fr-FR': 'Paramètres',
    'es-ES': 'Configuración',
    'pl-PL': 'Ustawienia'
  } as const
  for (const [locale, heading] of Object.entries(additionalHeadings)) {
    await selector.selectOption(locale)
    await expect(appWindow.locator('html')).toHaveAttribute('lang', locale)
    await expect(appWindow.getByRole('heading', { name: heading, exact: true })).toBeVisible()
    const layout = await appWindow.evaluate<{
      pageOverflow: number
      dialogOverflow: number
      sidebarContentOverflow: number
      sidebarScrollLeft: number
      dialogScrollLeft: number
      left: number
      right: number
      viewport: number
    }>(`(() => {
      const dialog = document.querySelector('.settings-dialog')
      const sidebar = document.querySelector('.settings-sidebar')
      const rect = dialog?.getBoundingClientRect()
      const sidebarRect = sidebar?.getBoundingClientRect()
      const navRight = Math.max(
        ...Array.from(document.querySelectorAll('.settings-nav-item'), (item) => item.getBoundingClientRect().right)
      )
      return {
        pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        dialogOverflow: dialog ? dialog.scrollWidth - dialog.clientWidth : 1,
        sidebarContentOverflow: sidebarRect ? Math.max(0, navRight - sidebarRect.right) : 1,
        sidebarScrollLeft: sidebar?.scrollLeft ?? -1,
        dialogScrollLeft: dialog?.scrollLeft ?? -1,
        left: rect?.left ?? -1,
        right: rect?.right ?? Number.POSITIVE_INFINITY,
        viewport: window.innerWidth
      }
    })()`)
    await appWindow.screenshot({ path: testInfo.outputPath(`${locale}-narrow.png`) })
    expect(layout.pageOverflow).toBeLessThanOrEqual(1)
    expect(layout.dialogOverflow).toBeLessThanOrEqual(1)
    expect(layout.sidebarContentOverflow).toBeLessThanOrEqual(1)
    expect(layout.sidebarScrollLeft).toBe(0)
    expect(layout.dialogScrollLeft).toBe(0)
    expect(layout.left).toBeGreaterThanOrEqual(0)
    expect(layout.right).toBeLessThanOrEqual(layout.viewport)
  }
})

test('keeps English and Ukrainian settings usable across themes and a narrow window', async ({ appWindow }, testInfo) => {
  await appWindow.getByRole('button', { name: 'Settings' }).click()
  await appWindow.screenshot({ path: testInfo.outputPath('en-US-system-normal.png') })
  await appWindow.setViewportSize({ width: 760, height: 640 })
  const selector = appWindow.locator('#setting-language')

  for (const locale of ['en-US', 'uk-UA'] as const) {
    await selector.selectOption(locale)
    for (const theme of ['system', 'light', 'dark', 'cyberpunk'] as const) {
      await appWindow.getByTestId(`theme-${theme}`).click()
      await expect(appWindow.locator('html')).toHaveAttribute('data-theme-preference', theme)
      if (theme !== 'system') await expect(appWindow.locator('html')).toHaveAttribute('data-theme', theme)
      const layout = await appWindow.evaluate<{
        pageOverflow: number
        dialogOverflow: number
        left: number
        right: number
        viewport: number
      }>(`(() => {
        const dialog = document.querySelector('.settings-dialog')
        const rect = dialog?.getBoundingClientRect()
        return {
          pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          dialogOverflow: dialog ? dialog.scrollWidth - dialog.clientWidth : 1,
          left: rect?.left ?? -1,
          right: rect?.right ?? Number.POSITIVE_INFINITY,
          viewport: window.innerWidth
        }
      })()`)
      expect(layout.pageOverflow).toBeLessThanOrEqual(1)
      expect(layout.dialogOverflow).toBeLessThanOrEqual(1)
      expect(layout.left).toBeGreaterThanOrEqual(0)
      expect(layout.right).toBeLessThanOrEqual(layout.viewport)
      await appWindow.screenshot({ path: testInfo.outputPath(`${locale}-${theme}-narrow.png`) })
    }
  }
})
