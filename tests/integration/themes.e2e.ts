import { mkdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { closeHronaut, expect, launchHronaut, test } from './fixtures.js'

test('offers regular and cinematic themes in Settings', async ({ appWindow, electronApp }) => {
  const initialNativeTheme = await electronApp.evaluate(({ nativeTheme }) => nativeTheme.shouldUseDarkColors ? 'dark' : 'light')
  await expect(appWindow.locator('html')).toHaveAttribute('data-theme-preference', 'system')
  await expect(appWindow.locator('html')).toHaveAttribute('data-theme', initialNativeTheme)
  await appWindow.getByRole('button', { name: 'Settings' }).click()
  await expect(appWindow.getByRole('dialog', { name: 'Settings' })).toBeVisible()
  const panelBounds = await appWindow.getByRole('dialog', { name: 'Settings' }).boundingBox()
  const websiteView = await electronApp.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0]
    return {
      bounds: window?.contentView.children[0]?.getBounds(),
      contentHeight: window?.getContentBounds().height
    }
  })
  expect(panelBounds).not.toBeNull()
  expect(websiteView.bounds?.y).toBeGreaterThanOrEqual((websiteView.contentHeight ?? 1) - 1)
  expect(websiteView.bounds?.y).toBeGreaterThanOrEqual(Math.ceil(panelBounds!.y + panelBounds!.height))

  for (const section of [/MCP security/, /Passwords/, /Commercial license/]) {
    await appWindow.getByRole('button', { name: section }).click()
    const sectionBounds = await appWindow.getByRole('dialog', { name: 'Settings' }).boundingBox()
    expect(sectionBounds?.height).toBeCloseTo(panelBounds!.height)
  }
  await appWindow.getByRole('button', { name: /Appearance/ }).click()

  await expect(appWindow.getByTestId('theme-system')).toHaveAttribute('aria-checked', 'true')

  for (const theme of ['light', 'dark', 'midnight', 'sepia', 'cyberpunk', 'matrix', 'machine', 'galactic'] as const) {
    await appWindow.getByTestId(`theme-${theme}`).click()
    await expect(appWindow.locator('html')).toHaveAttribute('data-theme', theme)
    await expect(appWindow.getByTestId(`theme-${theme}`)).toHaveAttribute('aria-checked', 'true')
    await expect.poll(() => appWindow.evaluate('document.documentElement.style.colorScheme')).toBe(
      theme === 'light' || theme === 'sepia' ? 'light' : 'dark'
    )
  }

  await appWindow.getByTestId('theme-system').click()
  await expect(appWindow.getByTestId('theme-system')).toHaveAttribute('aria-checked', 'true')
  await expect.poll(() => appWindow.evaluate('window.hronautSettings.get().then((settings) => settings.theme)')).toBe('system')
  await electronApp.evaluate(({ nativeTheme }) => { nativeTheme.themeSource = 'dark' })
  await expect(appWindow.locator('html')).toHaveAttribute('data-theme-preference', 'system')
  await expect(appWindow.locator('html')).toHaveAttribute('data-theme', 'dark')
  await electronApp.evaluate(({ nativeTheme }) => { nativeTheme.themeSource = 'light' })
  await expect(appWindow.locator('html')).toHaveAttribute('data-theme', 'light')
})

test('keeps the latest theme click selected when queued responses settle in request order', async ({
  appWindow,
  electronApp
}) => {
  const initialSettings = await appWindow.evaluate('window.hronautSettings.get()')
  await electronApp.evaluate(({ ipcMain }, settings) => {
    const mainGlobal = globalThis as typeof globalThis & {
      __queuedThemeRequests?: {
        initial: Record<string, unknown>
        requests: Array<{
          theme: string
          resolve: (value: Record<string, unknown>) => void
        }>
      }
    }
    const control = {
      initial: settings as Record<string, unknown>,
      requests: [] as Array<{
        theme: string
        resolve: (value: Record<string, unknown>) => void
      }>
    }
    mainGlobal.__queuedThemeRequests = control
    ipcMain.removeHandler('settings:set-theme')
    ipcMain.handle('settings:set-theme', (_event, theme: unknown) => new Promise((resolve) => {
      control.requests.push({
        theme: String(theme),
        resolve: (value) => resolve(value)
      })
    }))
  }, initialSettings)

  await appWindow.getByRole('button', { name: 'Settings' }).click()
  await appWindow.getByTestId('theme-light').click()
  await appWindow.getByTestId('theme-galactic').click()
  await expect.poll(() => electronApp.evaluate(() => (
    globalThis as typeof globalThis & {
      __queuedThemeRequests?: { requests: unknown[] }
    }
  ).__queuedThemeRequests?.requests.length)).toBe(2)

  await electronApp.evaluate(() => {
    const control = (globalThis as typeof globalThis & {
      __queuedThemeRequests?: {
        initial: Record<string, unknown>
        requests: Array<{
          theme: string
          resolve: (value: Record<string, unknown>) => void
        }>
      }
    }).__queuedThemeRequests
    if (!control || control.requests.length !== 2) throw new Error('Theme requests were not queued')
    for (const request of control.requests) {
      request.resolve({ ...control.initial, theme: request.theme })
    }
  })

  await expect(appWindow.getByTestId('theme-galactic')).toHaveAttribute('aria-checked', 'true')
  await expect(appWindow.locator('html')).toHaveAttribute('data-theme', 'galactic')
})

test('keeps rejected settings out of live state and later persisted changes', async ({
  appWindow,
  profileDirectory
}) => {
  const settingsPath = join(profileDirectory, 'settings.json')
  const blockedTemporaryPath = `${settingsPath}.tmp`
  await rm(blockedTemporaryPath, { recursive: true, force: true })
  await mkdir(blockedTemporaryPath)
  try {
    await appWindow.getByRole('button', { name: 'Settings' }).click()
    await appWindow.getByTestId('theme-dark').click()
    await expect(appWindow.getByRole('alert', { name: 'Setting not saved' })).toBeVisible()
    await expect(appWindow.getByTestId('theme-system')).toHaveAttribute('aria-checked', 'true')
    await expect.poll(() => appWindow.evaluate('window.hronautSettings.get()')).toMatchObject({ theme: 'system' })

    await rm(blockedTemporaryPath, { recursive: true, force: true })
    await appWindow.getByRole('button', { name: /Search engine/ }).click()
    await appWindow.getByTestId('search-engine-duckduckgo').click()
    await expect.poll(async () => JSON.parse(await readFile(settingsPath, 'utf8'))).toMatchObject({
      theme: 'system',
      searchEngine: 'duckduckgo'
    })
    await expect(appWindow.locator('html')).toHaveAttribute('data-theme-preference', 'system')

    await appWindow.evaluate(`Promise.all([
      window.hronautSettings.setTheme('cyberpunk'),
      window.hronautSettings.setSearchEngine('brave'),
      window.hronautSettings.setAttentionSound(false)
    ])`)
    await expect.poll(async () => JSON.parse(await readFile(settingsPath, 'utf8'))).toMatchObject({
      theme: 'cyberpunk',
      searchEngine: 'brave',
      attentionSound: false
    })
    await expect(appWindow.locator('html')).toHaveAttribute('data-theme', 'cyberpunk')
  } finally {
    await rm(blockedTemporaryPath, { recursive: true, force: true })
  }
})

test('keeps supporting text readable in Settings and page tools', async ({ appWindow }) => {
  await appWindow.getByRole('button', { name: 'Settings' }).click()
  await appWindow.getByRole('button', { name: /Privacy & data/ }).click()

  const settingsSizes = await appWindow.evaluate(`(() => ({
    navigation: Number.parseFloat(getComputedStyle(document.querySelector('.settings-nav-item small')).fontSize),
    description: Number.parseFloat(getComputedStyle(document.querySelector('.setting-copy p')).fontSize),
    privacyChoice: Number.parseFloat(getComputedStyle(document.querySelector('.privacy-category-options small')).fontSize)
  }))()`)
  expect(settingsSizes).toEqual({ navigation: 12, description: 14, privacyChoice: 12 })

  await appWindow.getByRole('button', { name: 'Close', exact: true }).click()
  await appWindow.getByRole('button', { name: 'New tab' }).click()
  await appWindow.getByRole('button', { name: 'Page tools' }).click()
  await expect(appWindow.getByRole('dialog', { name: 'Page tools' })).toBeVisible()
  const pageToolDescription = await appWindow.evaluate(
    "Number.parseFloat(getComputedStyle(document.querySelector('.page-tools-grid small')).fontSize)"
  )
  expect(pageToolDescription).toBe(12)
})

test('explains commercial license requirements and buys in the system browser', async ({ appWindow, electronApp }) => {
  await electronApp.evaluate(({ shell }) => {
    shell.openExternal = async (url): Promise<void> => {
      ;(globalThis as typeof globalThis & { __hronautExternalPurchaseUrl?: string })
        .__hronautExternalPurchaseUrl = url
    }
  })
  await appWindow.getByRole('button', { name: 'Settings' }).click()
  await appWindow.getByRole('button', { name: /Commercial license/ }).click()
  await expect(appWindow.getByText('Activate Hronaut for commercial use')).toBeVisible()
  await expect(appWindow.getByText(/commercial use requires an active paid subscription/i)).toBeVisible()
  await expect(appWindow.getByLabel('Commercial license key')).toBeVisible()
  await expect(appWindow.getByRole('button', { name: 'Activate commercial license' })).toBeVisible()
  const purchase = appWindow.getByRole('button', { name: 'Buy commercial license ↗' })
  await expect(purchase).toBeVisible()
  await expect(appWindow.getByRole('button', { name: 'PolyForm Noncommercial license ↗' })).toBeVisible()
  await expect(appWindow.getByRole('button', { name: 'Contributing guide ↗' })).toBeVisible()

  const tabCount = await appWindow.evaluate('window.hronaut.getState().then((state) => state.tabs.length)')
  await purchase.click()
  await expect.poll(() => electronApp.evaluate(() => (
    globalThis as typeof globalThis & { __hronautExternalPurchaseUrl?: string }
  ).__hronautExternalPurchaseUrl)).toBe('https://hronaut.dev/#pricing')
  await expect.poll(() => appWindow.evaluate('window.hronaut.getState().then((state) => state.tabs.length)')).toBe(tabCount)
})

test('persists the selected theme across application restarts', async ({
  appWindow,
  electronApp,
  mcpPort,
  profileDirectory
}) => {
  await appWindow.getByRole('button', { name: 'Settings' }).click()
  await appWindow.getByTestId('theme-cyberpunk').click()

  const settingsPath = join(profileDirectory, 'settings.json')
  await expect.poll(async () => JSON.parse(await readFile(settingsPath, 'utf8')).theme).toBe('cyberpunk')
  await closeHronaut(electronApp)

  const restarted = await launchHronaut(profileDirectory, mcpPort + 1)
  try {
    await expect(restarted.window.locator('html')).toHaveAttribute('data-theme', 'cyberpunk')
    await restarted.window.getByRole('button', { name: 'Settings' }).click()
    await expect(restarted.window.getByTestId('theme-cyberpunk')).toHaveAttribute('aria-checked', 'true')
  } finally {
    await closeHronaut(restarted.app)
  }
})

test('scales Hronaut without zooming the active website and persists the choice', async ({
  appWindow,
  electronApp,
  mcpPort,
  profileDirectory
}) => {
  await appWindow.getByRole('button', { name: 'New tab' }).click()
  await expect(appWindow.locator('.toolbar')).toBeVisible()
  await appWindow.getByRole('button', { name: 'Settings' }).click()
  const interfaceSize = appWindow.getByRole('combobox', { name: 'Interface size' })
  await expect(interfaceSize).toHaveValue('1')
  await interfaceSize.selectOption('1.25')
  await expect(interfaceSize).toHaveValue('1.25')
  await appWindow.getByRole('button', { name: 'Close', exact: true }).click()

  await expect.poll(() => electronApp.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0]
    const websiteView = window?.contentView.children[0] as Electron.WebContentsView | undefined
    return {
      shellZoom: window?.webContents.getZoomFactor(),
      websiteZoom: websiteView?.webContents.getZoomFactor(),
      websiteY: websiteView?.getBounds().y
    }
  })).toEqual({ shellZoom: 1.25, websiteZoom: 1, websiteY: 132 })

  await appWindow.getByRole('button', { name: 'Page tools' }).click()
  const detachedPromise = electronApp.waitForEvent('window')
  await appWindow.getByRole('dialog', { name: 'Page tools' })
    .getByRole('combobox', { name: 'Dock page tools' })
    .selectOption('window')
  const detached = await detachedPromise
  await detached.waitForLoadState('domcontentloaded')
  await expect.poll(() => electronApp.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().find((window) => window.getTitle() === 'Page tools — Hronaut')?.webContents.getZoomFactor()
  )).toBe(1.25)
  await detached.evaluate(`setTimeout(() => {
    const button = document.querySelector('button[aria-label="Close page tools"]')
    if (!(button instanceof HTMLButtonElement)) throw new Error('Missing page-tools close button')
    button.click()
  }, 0)`)
  await expect.poll(() => detached.isClosed()).toBe(true)

  await expect.poll(async () => JSON.parse(await readFile(join(profileDirectory, 'settings.json'), 'utf8')).interfaceScale).toBe(1.25)
  await closeHronaut(electronApp)

  const restarted = await launchHronaut(profileDirectory, mcpPort + 1)
  try {
    await expect.poll(() => restarted.app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]?.webContents.getZoomFactor()
    )).toBe(1.25)
    await restarted.window.getByRole('button', { name: 'Settings' }).click()
    await expect(restarted.window.getByRole('combobox', { name: 'Interface size' })).toHaveValue('1.25')
  } finally {
    await closeHronaut(restarted.app)
  }
})

test('resets every Appearance preference including interface size', async ({
  appWindow,
  electronApp,
  profileDirectory
}) => {
  await appWindow.getByRole('button', { name: 'Settings' }).click()
  await appWindow.getByTestId('theme-cyberpunk').click()
  await appWindow.getByRole('combobox', { name: 'Interface size' }).selectOption('1.25')
  await appWindow.getByRole('combobox', { name: 'Tab position' }).selectOption('left')
  await appWindow.getByRole('checkbox', { name: 'Hide in tray when closing' }).uncheck()
  await appWindow.getByRole('checkbox', { name: 'Play attention sound' }).uncheck()
  await appWindow.locator('#setting-language').selectOption('uk-UA')
  await expect(appWindow.locator('html')).toHaveAttribute('lang', 'uk-UA')
  await appWindow.evaluate(() => {
    const page = window as typeof window & {
      hronautSettings: {
        onChanged: (listener: () => void) => () => void
      }
      __appearanceResetProbe?: { count: () => number, dispose: () => void }
    }
    let count = 0
    const dispose = page.hronautSettings.onChanged(() => { count += 1 })
    page.__appearanceResetProbe = { count: () => count, dispose }
  })

  await appWindow.locator('.settings-footer .secondary-button').click()

  await expect(appWindow.locator('html')).toHaveAttribute('lang', 'en-US')
  await expect(appWindow.getByTestId('theme-system')).toHaveAttribute('aria-checked', 'true')
  await expect(appWindow.locator('#setting-language')).toHaveValue('system')
  await expect(appWindow.getByRole('combobox', { name: 'Interface size' })).toHaveValue('1')
  await expect(appWindow.getByRole('combobox', { name: 'Tab position' })).toHaveValue('top')
  await expect(appWindow.getByRole('checkbox', { name: 'Hide in tray when closing' })).toBeChecked()
  await expect(appWindow.getByRole('checkbox', { name: 'Play attention sound' })).toBeChecked()
  await expect.poll(() => electronApp.evaluate(({ BrowserWindow }) => (
    BrowserWindow.getAllWindows()[0]?.webContents.getZoomFactor()
  ))).toBe(1)
  await expect.poll(async () => JSON.parse(await readFile(join(profileDirectory, 'settings.json'), 'utf8'))).toMatchObject({
    theme: 'system',
    interfaceScale: 1,
    tabPosition: 'top',
    hideInTray: true,
    attentionSound: true,
    attentionSoundCue: 'warning',
    languagePreference: 'system'
  })
  await expect.poll(() => appWindow.evaluate(() => {
    const page = window as typeof window & {
      __appearanceResetProbe?: { count: () => number }
    }
    return page.__appearanceResetProbe?.count()
  })).toBe(1)
  await appWindow.evaluate(() => {
    const page = window as typeof window & {
      __appearanceResetProbe?: { dispose: () => void }
    }
    page.__appearanceResetProbe?.dispose()
    delete page.__appearanceResetProbe
  })
})

test('can disable hiding in the tray so closing the window quits Hronaut', async ({ appWindow, electronApp }) => {
  await appWindow.getByRole('button', { name: 'Settings' }).click()
  const hideInTray = appWindow.getByRole('checkbox', { name: 'Hide in tray when closing' })
  await expect(hideInTray).toBeChecked()
  await hideInTray.uncheck()

  const child = electronApp.process()
  const exited = new Promise<number | null>((resolve) => child.once('exit', resolve))
  await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.close())
  await expect(exited).resolves.toBe(0)
})

test('can disable the attention sound', async ({ appWindow, profileDirectory }) => {
  await appWindow.getByRole('button', { name: 'Settings' }).click()
  const attentionSound = appWindow.getByRole('checkbox', { name: 'Play attention sound' })
  const attentionSoundCue = appWindow.getByRole('combobox', { name: 'Attention sound' })
  const testSound = appWindow.getByRole('button', { name: 'Test sound' })
  await expect(attentionSound).toBeChecked()
  await expect(attentionSoundCue).toHaveValue('warning')
  await expect(attentionSoundCue.locator('option')).toHaveCount(11)
  await attentionSoundCue.selectOption('bell')

  const settingsPath = join(profileDirectory, 'settings.json')
  await expect.poll(async () => {
    try {
      return JSON.parse(await readFile(settingsPath, 'utf8')).attentionSoundCue
    } catch {
      return undefined
    }
  }).toBe('bell')
  await attentionSound.uncheck()
  await expect.poll(async () => JSON.parse(await readFile(settingsPath, 'utf8')).attentionSound).toBe(false)
  await expect(attentionSoundCue).toBeDisabled()
  await expect(testSound).toBeDisabled()
})

test('keeps MCP running when the window is closed to the tray', async ({
  appWindow: _appWindow,
  electronApp,
  mcpPort,
  mcpToken
}) => {
  const health = (): Promise<Response> => fetch(`http://127.0.0.1:${mcpPort}/healthz`, {
    headers: { authorization: `Bearer ${mcpToken}` }
  })
  await expect.poll(async () => health().then((response) => response.ok).catch(() => false)).toBe(true)

  await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.close())
  await expect.poll(() => electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isVisible())).toBe(false)

  const response = await health()
  expect(response.ok).toBe(true)
  expect(await response.json()).toMatchObject({ ok: true, name: 'hronaut' })
})
