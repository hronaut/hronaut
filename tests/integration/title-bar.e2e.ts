import { closeHronaut, expect, launchHronaut, test } from './fixtures.js'

async function appRegion(locator: import('@playwright/test').Locator): Promise<string> {
  return locator.evaluate((element) => getComputedStyle(element).getPropertyValue('-webkit-app-region'))
}

test('uses the horizontal tab strip as the title bar without swallowing tab or address interactions', async ({
  appWindow,
  electronApp
}) => {
  await expect(appWindow.locator('html')).toHaveAttribute('data-title-bar-mode', 'overlay')
  const topbar = appWindow.locator('.topbar')
  await expect(topbar).toHaveAttribute('data-titlebar-drag-surface', '')
  expect(await appRegion(topbar)).toBe('drag')
  const [topbarBounds, homeBounds] = await Promise.all([
    topbar.boundingBox(),
    appWindow.getByRole('button', { name: 'Open Hronaut Home' }).boundingBox()
  ])
  expect(topbarBounds).not.toBeNull()
  expect(homeBounds).not.toBeNull()
  expect(Math.round(homeBounds!.x - topbarBounds!.x)).toBeLessThanOrEqual(20)
  await appWindow.evaluate(() => { document.documentElement.dataset.desktopPlatform = 'darwin' })
  await expect.poll(async () => {
    const bounds = await appWindow.getByRole('button', { name: 'Open Hronaut Home' }).boundingBox()
    return Math.round((bounds?.x ?? 0) - topbarBounds!.x)
  }).toBeGreaterThanOrEqual(100)
  await appWindow.evaluate(() => { document.documentElement.dataset.desktopPlatform = 'linux' })
  await expect.poll(async () => {
    const bounds = await appWindow.getByRole('button', { name: 'Open Hronaut Home' }).boundingBox()
    return Math.round((bounds?.x ?? 0) - topbarBounds!.x)
  }).toBeLessThanOrEqual(20)
  await appWindow.evaluate(() => {
    document.documentElement.style.setProperty('--titlebar-controls-left-runtime', '144px')
    document.documentElement.style.setProperty('--titlebar-controls-right-runtime', '0px')
  })
  await expect.poll(async () => {
    const bounds = await appWindow.getByRole('button', { name: 'Open Hronaut Home' }).boundingBox()
    return Math.round((bounds?.x ?? 0) - topbarBounds!.x)
  }).toBeGreaterThanOrEqual(150)
  await appWindow.evaluate(() => {
    document.documentElement.style.setProperty('--titlebar-controls-left-runtime', '0px')
    document.documentElement.style.setProperty('--titlebar-controls-right-runtime', '144px')
  })
  await expect.poll(async () => {
    const bounds = await appWindow.getByRole('button', { name: 'Open Hronaut Home' }).boundingBox()
    return Math.round((bounds?.x ?? 0) - topbarBounds!.x)
  }).toBeLessThanOrEqual(20)

  await appWindow.getByRole('button', { name: 'New tab' }).click()
  const activeTab = appWindow.locator('.tab.active')
  await expect(activeTab).toBeVisible()
  await expect(activeTab.locator('.tab-active-indicator')).toBeVisible()
  await expect(activeTab).toHaveAttribute('draggable', 'true')
  expect(await appRegion(activeTab)).toBe('no-drag')

  const createWorkspaceButton = appWindow.getByRole('button', { name: 'Create workspace' })
  const createWorkspaceLabel = createWorkspaceButton.locator('span')
  expect(await appRegion(createWorkspaceButton)).toBe('no-drag')
  expect(await appRegion(createWorkspaceLabel)).toBe('no-drag')
  await createWorkspaceLabel.click()
  const createWorkspaceDialog = appWindow.getByRole('dialog', { name: 'Create workspace' })
  await expect(createWorkspaceDialog).toBeVisible()
  await createWorkspaceDialog.getByRole('button', { name: 'Cancel' }).click()

  const address = appWindow.getByRole('combobox', { name: 'Address' })
  await expect(address).toBeVisible()
  expect(await appRegion(address)).toBe('no-drag')
  await address.fill('example.com/title-bar-selection')
  await address.press('ControlOrMeta+A')
  await expect.poll(() => address.evaluate((input) => ({
    start: (input as HTMLInputElement).selectionStart,
    end: (input as HTMLInputElement).selectionEnd,
    length: (input as HTMLInputElement).value.length
  }))).toEqual({ start: 0, end: 31, length: 31 })

  await expect.poll(() => electronApp.evaluate(({ BrowserWindow }) => {
    const main = BrowserWindow.getAllWindows().find((window) => window.getTitle() === 'Hronaut')
    return { autoHide: main?.isMenuBarAutoHide(), visible: main?.isMenuBarVisible() }
  })).toEqual({ autoHide: true, visible: false })

  await electronApp.evaluate(({ Menu }) => {
    const mainGlobal = globalThis as typeof globalThis & { __hronautAltMenuShown?: boolean }
    mainGlobal.__hronautAltMenuShown = false
    Menu.getApplicationMenu()?.once('menu-will-show', () => { mainGlobal.__hronautAltMenuShown = true })
  })
  await electronApp.evaluate(({ BrowserWindow }) => {
    const main = BrowserWindow.getAllWindows().find((window) => window.getTitle() === 'Hronaut')
    main?.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Alt' })
    main?.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Alt' })
  })
  await expect.poll(() => electronApp.evaluate(() => (
    (globalThis as typeof globalThis & { __hronautAltMenuShown?: boolean }).__hronautAltMenuShown
  ))).toBe(true)
  await electronApp.evaluate(({ BrowserWindow, Menu }) => {
    const main = BrowserWindow.getAllWindows().find((window) => window.getTitle() === 'Hronaut')
    if (main) Menu.getApplicationMenu()?.closePopup(main)
    delete (globalThis as typeof globalThis & { __hronautAltMenuShown?: boolean }).__hronautAltMenuShown
  })
})

test('keeps the vertical rail on the left and confines Home and navigation surfaces to the right column', async ({
  appWindow,
  electronApp
}) => {
  await appWindow.getByRole('button', { name: 'Settings' }).click()
  await appWindow.getByRole('combobox', { name: 'Tab position' }).selectOption('left')
  await appWindow.getByRole('button', { name: 'Close', exact: true }).click()

  const rail = appWindow.locator('.topbar')
  const railTitle = appWindow.locator('.shell-title-bar-surface.surface-rail')
  const homeTitle = appWindow.locator('.shell-title-bar-surface.surface-home')
  await expect(railTitle).toHaveAttribute('data-titlebar-drag-surface', '')
  await expect(homeTitle).toHaveAttribute('data-titlebar-drag-surface', '')
  expect(await appRegion(railTitle)).toBe('drag')
  expect(await appRegion(homeTitle)).toBe('drag')

  const homeGeometry = await Promise.all([rail.boundingBox(), railTitle.boundingBox(), homeTitle.boundingBox()])
  expect(homeGeometry.every(Boolean)).toBe(true)
  expect(homeGeometry[1]!.x).toBe(0)
  expect(homeGeometry[2]!.x).toBeGreaterThanOrEqual(homeGeometry[0]!.x + homeGeometry[0]!.width - 1)
  expect(homeGeometry[2]!.width).toBeLessThanOrEqual(await appWindow.evaluate(() => window.innerWidth) - homeGeometry[0]!.width + 1)
  const railMarkBounds = await railTitle.locator('.shell-title-bar-mark').boundingBox()
  expect(railMarkBounds).not.toBeNull()
  expect(Math.round(railMarkBounds!.x - homeGeometry[1]!.x)).toBeLessThanOrEqual(20)
  const [homeButtonBounds, homeIconBounds] = await Promise.all([
    appWindow.getByRole('button', { name: 'Open Hronaut Home' }).boundingBox(),
    appWindow.getByRole('button', { name: 'Open Hronaut Home' }).locator('svg').boundingBox()
  ])
  expect(homeButtonBounds).not.toBeNull()
  expect(homeIconBounds).not.toBeNull()
  expect(Math.round(homeButtonBounds!.x - homeGeometry[0]!.x)).toBeLessThanOrEqual(12)
  expect(Math.round(homeIconBounds!.x - homeGeometry[0]!.x)).toBeLessThanOrEqual(24)

  await appWindow.getByRole('button', { name: 'New tab' }).click()
  const toolbar = appWindow.locator('.toolbar')
  await expect(toolbar).toHaveAttribute('data-titlebar-drag-surface', '')
  const [railBounds, toolbarBounds] = await Promise.all([rail.boundingBox(), toolbar.boundingBox()])
  expect(railBounds).not.toBeNull()
  expect(toolbarBounds).not.toBeNull()
  expect(toolbarBounds!.x).toBeGreaterThanOrEqual(railBounds!.x + railBounds!.width - 1)
  expect(toolbarBounds!.width).toBeLessThanOrEqual(await appWindow.evaluate(() => window.innerWidth) - railBounds!.width + 1)
  expect(await appRegion(appWindow.getByRole('combobox', { name: 'Address' }))).toBe('no-drag')
  expect(await appRegion(appWindow.getByRole('button', { name: 'Reload' }))).toBe('no-drag')

  await electronApp.evaluate(({ Menu }) => {
    ;(globalThis as typeof globalThis & { __hronautVerticalTabMenu?: Electron.Menu })
      .__hronautVerticalTabMenu = undefined
    Menu.prototype.popup = function (): void {
      ;(globalThis as typeof globalThis & { __hronautVerticalTabMenu?: Electron.Menu })
        .__hronautVerticalTabMenu = this
    }
  })
  await appWindow.locator('.tab.active').click({ button: 'right' })
  await expect.poll(() => electronApp.evaluate(() => {
    const menu = (globalThis as typeof globalThis & { __hronautVerticalTabMenu?: Electron.Menu })
      .__hronautVerticalTabMenu
    return ['move-tab-left', 'move-tab-right', 'close-tabs-to-right']
      .map((id) => menu?.getMenuItemById(id)?.label ?? null)
  })).toEqual(['Move Tab Up', 'Move Tab Down', 'Close Tabs Below'])
  await toolbar.hover()

  await electronApp.evaluate(({ BrowserWindow }) => {
    const main = BrowserWindow.getAllWindows().find((window) => window.getTitle() === 'Hronaut')
    if (!main) throw new Error('Missing main window')
    const original = main.setTitleBarOverlay.bind(main)
    ;(main as typeof main & { setTitleBarOverlay: typeof main.setTitleBarOverlay }).setTitleBarOverlay = (options) => {
      ;(globalThis as typeof globalThis & { __hronautTitleBarOverlay?: Electron.TitleBarOverlay }).__hronautTitleBarOverlay = options
      original(options)
    }
  })
  await appWindow.evaluate('window.hronautSettings.setTheme("matrix")')
  await expect.poll(() => electronApp.evaluate(() => (
    (globalThis as typeof globalThis & { __hronautTitleBarOverlay?: Electron.TitleBarOverlay })
      .__hronautTitleBarOverlay
  ))).toMatchObject({ color: '#030d06', symbolColor: '#d9ffe0', height: 44 })

  await electronApp.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows().find((window) => window.getTitle() === 'Hronaut')?.setSize(760, 520)
  })
  await expect.poll(async () => {
    const [left, right] = await Promise.all([rail.boundingBox(), toolbar.boundingBox()])
    return left && right ? {
      compact: await appWindow.locator('.shell').evaluate((element) => (
        element.classList.contains('compact-vertical-tab-rail')
      )),
      railWidth: Math.round(left.width),
      joined: right.x >= left.x + left.width - 1,
      withinViewport: right.x + right.width <= await appWindow.evaluate(() => window.innerWidth) + 1
    } : null
  }).toEqual({ compact: true, railWidth: 56, joined: true, withinViewport: true })
  const compactToolbar = await toolbar.evaluate((element) => {
    const address = element.querySelector('.address-form')?.getBoundingClientRect()
    return {
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
      addressWidth: Math.round(address?.width ?? 0)
    }
  })
  expect(compactToolbar.scrollWidth).toBeLessThanOrEqual(compactToolbar.clientWidth)
  expect(compactToolbar.addressWidth).toBeGreaterThanOrEqual(120)
  await rail.hover()
  await expect(appWindow.getByRole('button', { name: 'Settings' })).toBeVisible()
  await expect.poll(() => rail.evaluate((element) => Math.round(element.getBoundingClientRect().width))).toBe(280)
  await expect.poll(() => railTitle.evaluate((element) => Math.round(element.getBoundingClientRect().width))).toBe(280)
  const expandedToolbar = await toolbar.evaluate((element) => {
    const bounds = element.getBoundingClientRect()
    const address = element.querySelector('.address-form')?.getBoundingClientRect()
    return {
      x: Math.round(bounds.x),
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
      addressWidth: Math.round(address?.width ?? 0)
    }
  })
  expect(expandedToolbar.x).toBe(56)
  expect(expandedToolbar.scrollWidth).toBeLessThanOrEqual(expandedToolbar.clientWidth)
  expect(expandedToolbar.addressWidth).toBeGreaterThanOrEqual(120)
  await toolbar.hover()
  await expect.poll(() => rail.evaluate((element) => Math.round(element.getBoundingClientRect().width))).toBe(56)
  await expect.poll(() => railTitle.evaluate((element) => Math.round(element.getBoundingClientRect().width))).toBe(56)
})

test('persists the system-title-bar fallback across restart on every platform', async ({
  appWindow,
  electronApp,
  profileDirectory,
  mcpPort
}) => {
  await appWindow.getByRole('button', { name: 'Settings' }).click()
  await appWindow.getByRole('combobox', { name: 'Tab position' }).selectOption('left')
  const fallback = appWindow.getByRole('checkbox', { name: 'Use system title bar' })
  await expect(fallback).not.toBeChecked()
  await fallback.check()
  await expect(appWindow.getByRole('status')).toContainText('Restart Hronaut')
  await expect(appWindow.locator('html')).toHaveAttribute('data-title-bar-mode', 'overlay')

  await closeHronaut(electronApp)
  const restarted = await launchHronaut(profileDirectory, mcpPort + 1)
  try {
    await expect(restarted.window.locator('html')).toHaveAttribute('data-title-bar-mode', 'system')
    await expect(restarted.window.locator('.shell')).toHaveClass(/vertical-tabs-shell/)
    await expect(restarted.window.locator('.shell')).not.toHaveClass(/custom-title-bar/)
    await expect(restarted.window.locator('.shell-title-bar-surface')).toHaveCount(0)
    await expect(restarted.window.locator('[data-titlebar-drag-surface]')).toHaveCount(0)
    await expect.poll(() => restarted.window.locator('.topbar').evaluate((element) => element.getBoundingClientRect().y)).toBe(0)
    await restarted.window.getByRole('button', { name: 'Settings' }).click()
    await expect(restarted.window.getByRole('checkbox', { name: 'Use system title bar' })).toBeChecked()
    await expect(restarted.window.getByRole('status')).toHaveCount(0)
  } finally {
    await closeHronaut(restarted.app)
  }
})
