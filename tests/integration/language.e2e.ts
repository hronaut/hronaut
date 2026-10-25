import { readFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { join } from 'node:path'
import type { HronautApi } from '../../src/shared/types.js'
import { closeFixtureServer, closeHronaut, expect, launchHronaut, settleShellMotion, test } from './fixtures.js'

test('switches language live through Settings and persists it across restart', async ({
  appWindow,
  electronApp,
  mcpPort,
  profileDirectory
}) => {
  await appWindow.getByRole('button', { name: 'Settings' }).click()
  await appWindow.locator('.settings-nav-item').nth(0).click()
  const selector = appWindow.locator('#setting-language')
  await expect(selector).toHaveValue('system')
  await selector.selectOption('uk-UA')

  await expect(appWindow.locator('html')).toHaveAttribute('lang', 'uk-UA')
  await expect(appWindow.getByRole('heading', { name: 'Загальні' })).toBeVisible()
  await expect(appWindow.getByRole('button', { name: 'Налаштування', exact: true })).toHaveAttribute('aria-pressed', 'true')
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
    await restarted.window.locator('.settings-nav-item').nth(0).click()
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
  await appWindow.locator('.settings-nav-item').nth(0).click()
  const selector = appWindow.locator('#setting-language')
  await selector.selectOption('uk-UA')

  await expect(appWindow.locator('html')).toHaveAttribute('lang', 'uk-UA')
  await expect(selector).toHaveValue('uk-UA')
  await expect(appWindow.getByRole('heading', { name: 'Загальні' })).toBeVisible()
  expect(await electronApp.evaluate(({ Menu }) => Menu.getApplicationMenu()?.items.map((item) => item.label))).toContain('Редагування')
  await expect
    .poll(async () => JSON.parse(await readFile(join(profileDirectory, 'settings.json'), 'utf8')).languagePreference)
    .toBe('uk-UA')
  await expect.poll(() => electronApp.evaluate(async ({ webContents }) => {
    const home = webContents.getAllWebContents().find((contents) => contents.getURL().startsWith('hronaut://home'))
    if (!home) return null
    try {
      return await home.executeJavaScript(`document.documentElement.lang`)
    } catch {
      return null
    }
  })).toBe('uk-UA')
  await expect(appWindow.getByRole('alert')).toHaveCount(0)
})

test('supports Russian and the additional language choices', async ({ appWindow }, testInfo) => {
  await appWindow.getByRole('button', { name: 'Settings' }).click()
  await appWindow.locator('.settings-nav-item').nth(0).click()
  await appWindow.setViewportSize({ width: 760, height: 640 })
  const selector = appWindow.locator('#setting-language')
  await expect(selector.locator('option')).toHaveCount(16)

  const additionalHeadings = {
    'ru-RU': 'Настройки',
    'de-DE': 'Einstellungen',
    'fr-FR': 'Paramètres',
    'es-ES': 'Configuración',
    'pl-PL': 'Ustawienia',
    'it-IT': 'Impostazioni',
    'pt-BR': 'Configurações',
    'tr-TR': 'Ayarlar',
    'hi-IN': 'सेटिंग',
    'ja-JP': '設定',
    'ko-KR': '설정',
    'zh-CN': '设置',
    'zh-TW': '設定'
  } as const
  for (const [locale, heading] of Object.entries(additionalHeadings)) {
    await selector.selectOption(locale)
    await expect(appWindow.locator('html')).toHaveAttribute('lang', locale)
    await expect(appWindow.getByRole('tabpanel', { name: heading, exact: true })).toBeVisible()
    // Settings grows into place as it opens, a hair past its full size; measure the layout it settles at.
    await settleShellMotion(appWindow)
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
  const sections = appWindow.locator('.settings-nav-item')
  const selector = appWindow.locator('#setting-language')

  for (const locale of ['en-US', 'uk-UA'] as const) {
    await sections.nth(0).click()
    await selector.selectOption(locale)
    await sections.nth(1).click()
    for (const theme of ['system', 'light', 'dark', 'midnight', 'sepia', 'cyberpunk', 'matrix', 'machine', 'galactic'] as const) {
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

test('keeps late Settings sections reachable by mouse wheel at large interface scale', async ({ appWindow }, testInfo) => {
  await appWindow.setViewportSize({ width: 760, height: 640 })
  await appWindow.getByRole('button', { name: 'Settings' }).click()
  await appWindow.getByRole('button', { name: /^Appearance/ }).click()
  await appWindow.getByRole('combobox', { name: 'Interface size' }).selectOption('1.25')

  const navigation = appWindow.getByRole('navigation', { name: 'Settings sections' })
  await expect.poll(() => navigation.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true)
  await navigation.hover()
  for (let index = 0; index < 4; index += 1) await appWindow.mouse.wheel(0, 700)
  await expect.poll(() => navigation.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0)

  const support = appWindow.getByRole('button', { name: /License/ })
  await expect.poll(async () => {
    const [navigationBox, supportBox] = await Promise.all([navigation.boundingBox(), support.boundingBox()])
    return Boolean(
      navigationBox
      && supportBox
      && supportBox.x >= navigationBox.x - 1
      && supportBox.x + supportBox.width <= navigationBox.x + navigationBox.width + 1
    )
  }).toBe(true)
  await support.click()
  await expect(appWindow.getByRole('heading', { name: 'Activate Hronaut' })).toBeVisible()
  await appWindow.screenshot({ path: testInfo.outputPath('settings-large-scale-wheel.png') })
})

test('names a new tab in the interface language while agents keep its English title', async ({ appWindow, electronApp }) => {
  // Hronaut gave every blank tab the English title "New tab", and the tab strip showed it in every language.
  await appWindow.getByRole('button', { name: 'Settings' }).click()
  await appWindow.locator('.settings-nav-item').nth(0).click()
  await appWindow.locator('#setting-language').selectOption('uk-UA')
  await expect(appWindow.locator('html')).toHaveAttribute('lang', 'uk-UA')
  await appWindow.keyboard.press('Control+t')
  const strip = appWindow.getByRole('group', { name: 'Вкладки й робочі простори браузера' })
  await expect(strip.locator('.tab-title').last()).toHaveText('Нова вкладка')
  await expect(strip).not.toContainText('New tab')
  await expect.poll(async () => (await appWindow.evaluate('window.hronaut.getState()') as { tabs: Array<{ title: string; url: string }> })
    .tabs.filter((tab) => tab.url === 'about:blank').map((tab) => tab.title)).toEqual(['New tab'])

  // The tab menu's Open beside list, shown from Home, names the other blank tab the same way.
  await appWindow.keyboard.press('Control+t')
  await expect(strip.locator('.tab-title')).toHaveText(['Нова вкладка', 'Нова вкладка'])
  await appWindow.evaluate('window.hronaut.openHome()')
  await electronApp.evaluate(({ Menu }) => {
    Menu.prototype.popup = function (): void {
      ;(globalThis as typeof globalThis & { __hronautTabMenu?: Electron.Menu }).__hronautTabMenu = this
    }
  })
  await strip.locator('.tab-title').first().click({ button: 'right' })
  await expect.poll(() => electronApp.evaluate(() => {
    const menu = (globalThis as typeof globalThis & { __hronautTabMenu?: Electron.Menu }).__hronautTabMenu
    return menu?.getMenuItemById('open-in-split-view')?.submenu?.items.map((item) => item.label)
  })).toEqual(['Нова вкладка'])
})

test('names a tab whose site could not be reached in the interface language', async ({ appWindow }) => {
  // A failed load gave the tab the English title "Site unavailable" in every language.
  const server = createServer()
  const port = await new Promise<number>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') reject(new Error('The closed-port fixture did not expose a port'))
      else resolve(address.port)
    })
  })
  await closeFixtureServer(server)
  const failedUrl = `http://127.0.0.1:${port}/unreachable`

  await appWindow.evaluate("window.hronautSettings.setLanguagePreference('uk-UA')")
  await expect(appWindow.locator('html')).toHaveAttribute('lang', 'uk-UA')
  await appWindow.evaluate((url) => (window as unknown as { hronaut: HronautApi }).hronaut.newTab({ url, active: true }), failedUrl)
  await expect.poll(() => appWindow.evaluate((url) => (window as unknown as { hronaut: HronautApi }).hronaut.getState().then((state) => {
    const tab = state.tabs.find((candidate) => candidate.url === url)
    return tab?.pageProblem ? { title: tab.title, problem: tab.pageProblem.title } : null
  }), failedUrl)).toEqual({ title: 'Сайт недоступний', problem: 'Не вдалося відкрити сайт' })
  const strip = appWindow.getByRole('group', { name: 'Вкладки й робочі простори браузера' })
  await expect(strip.locator('.tab-title').last()).toHaveText('Сайт недоступний')
  await expect(strip).not.toContainText('Site unavailable')
})

test('says why a tab cannot sleep in the interface language', async ({ appWindow }) => {
  // Errors from the main process reached the shell in English whatever the interface language.
  await appWindow.evaluate("window.hronautSettings.setLanguagePreference('uk-UA')")
  await expect(appWindow.locator('html')).toHaveAttribute('lang', 'uk-UA')
  const tabId = await appWindow.evaluate(() => (window as unknown as { hronaut: HronautApi }).hronaut
    .newTab({ url: 'http://127.0.0.1:9/', active: true }).then((state) => state.activeTabId))
  const message = await appWindow.evaluate((id) => (window as unknown as { hronaut: HronautApi }).hronaut
    .setTabSleeping(id!, true).then(() => 'slept', (error: unknown) => error instanceof Error ? error.message : String(error)), tabId)
  expect(message).toContain('Видиму вкладку не можна приспати.')
  expect(message).not.toContain('cannot sleep')
})
