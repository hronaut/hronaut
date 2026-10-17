import { dimTitleBarOverlay, parseScrimColor } from '../../src/shared/title-bar.js'
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

  await electronApp.evaluate(({ BrowserWindow, Menu }) => {
    const mainGlobal = globalThis as typeof globalThis & {
      __hronautAltMenu?: { shown: number; closed: number; stop: () => void }
    }
    const main = BrowserWindow.getAllWindows().find((window) => window.getTitle() === 'Hronaut')
    const menu = Menu.getApplicationMenu()
    const record = { shown: 0, closed: 0, stop: (): void => undefined }
    const listener = (): void => {
      record.shown += 1
      // A visible native menu can block a later Playwright main-process
      // evaluation under hosted-runner load. Close it from the same native
      // event turn so the Alt-access assertion cannot strand teardown.
      setImmediate(() => {
        if (main && !main.isDestroyed()) menu?.closePopup(main)
        record.closed += 1
      })
    }
    menu?.on('menu-will-show', listener)
    record.stop = () => { menu?.off('menu-will-show', listener) }
    mainGlobal.__hronautAltMenu = record
  })
  // Alt with a digit is a workspace key and opens nothing, even when Alt is released first; Alt alone shows the menu
  // when it is released. Keys reach the window in order, so the single bare Alt menu proves the digit opened none.
  await electronApp.evaluate(({ BrowserWindow }) => {
    const main = BrowserWindow.getAllWindows().find((window) => window.getTitle() === 'Hronaut')
    main?.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Alt' })
    main?.webContents.sendInputEvent({ type: 'keyDown', keyCode: '1', modifiers: ['alt'] })
    main?.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Alt' })
    main?.webContents.sendInputEvent({ type: 'keyUp', keyCode: '1' })
    main?.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Alt' })
    main?.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Alt' })
  })
  const altMenu = () => electronApp.evaluate(() => {
    const record = (globalThis as typeof globalThis & { __hronautAltMenu?: { shown: number; closed: number } }).__hronautAltMenu
    return { shown: record?.shown, closed: record?.closed }
  })
  try {
    await expect.poll(altMenu).toEqual({ shown: 1, closed: 1 })
  } finally {
    await electronApp.evaluate(() => {
      const mainGlobal = globalThis as typeof globalThis & { __hronautAltMenu?: { stop: () => void } }
      mainGlobal.__hronautAltMenu?.stop()
      delete mainGlobal.__hronautAltMenu
    })
  }
})

test('keeps the vertical rail on the left and confines Home and navigation surfaces to the right column', async ({
  appWindow,
  electronApp
}) => {
  await appWindow.getByRole('button', { name: 'Settings' }).click()
  await appWindow.getByRole('combobox', { name: 'Tab position' }).selectOption('left')
  await appWindow.getByRole('button', { name: 'Close settings', exact: true }).click()

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
  // A rail control keeps the expanded rail open while it owns keyboard focus.
  // Test collapsed geometry after explicitly moving focus into the toolbar.
  await appWindow.getByRole('combobox', { name: 'Address' }).focus()
  await expect(appWindow.getByRole('combobox', { name: 'Address' })).toBeFocused()

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
  ))).toMatchObject({ color: '#020b05', symbolColor: '#d9ffe0', height: 44 })

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
  expect(expandedToolbar.x).toBe(280)
  expect(expandedToolbar.scrollWidth).toBeLessThanOrEqual(expandedToolbar.clientWidth)
  expect(expandedToolbar.addressWidth).toBeGreaterThanOrEqual(120)
  await toolbar.hover()
  await expect.poll(() => rail.evaluate((element) => Math.round(element.getBoundingClientRect().width))).toBe(56)
  await expect.poll(() => railTitle.evaluate((element) => Math.round(element.getBoundingClientRect().width))).toBe(56)
})

test('keeps the window controls\' room steady while the window widens and narrows', async ({ appWindow, electronApp }) => {
  await expect(appWindow.locator('html')).toHaveAttribute('data-title-bar-mode', 'overlay')
  const resize = (width: number) => electronApp.evaluate(({ BrowserWindow }, width) => {
    const main = BrowserWindow.getAllWindows().find((window) => window.getTitle() === 'Hronaut')
    if (!main) throw new Error('Missing main window')
    main.setSize(width, 900)
  }, width)
  // The room the overlay leaves right of the title bar area, and the room the shell keeps for the controls.
  const room = () => appWindow.evaluate(() => {
    const overlay = (navigator as Navigator & { windowControlsOverlay: { getTitlebarAreaRect(): DOMRect } }).windowControlsOverlay
    const area = overlay.getTitlebarAreaRect()
    return {
      viewport: window.innerWidth,
      overlay: `${window.innerWidth - area.x - area.width}px`,
      shell: document.documentElement.style.getPropertyValue('--titlebar-controls-right-runtime')
    }
  })
  await expect.poll(async () => {
    const { overlay, shell } = await room()
    return overlay !== '0px' && overlay === shell
  }).toBe(true)
  const { shell: steady } = await room()

  // Every value the shell gives the controls' room meanwhile, from each change of its style.
  await appWindow.evaluate(() => {
    const read = (style: string | null) => /--titlebar-controls-right-runtime:\s*([^;]+)/u.exec(style ?? '')?.[1]?.trim()
    const seen = new Set<string>([read(document.documentElement.getAttribute('style')) ?? ''])
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        const before = read(record.oldValue)
        if (before) seen.add(before)
      }
      const now = read(document.documentElement.getAttribute('style'))
      if (now) seen.add(now)
    })
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['style'], attributeOldValue: true })
    ;(window as Window & { __hronautControlsRoom?: { seen: Set<string>; stop: () => void } }).__hronautControlsRoom = {
      seen,
      stop: () => observer.disconnect()
    }
  })
  try {
    // Chromium reports the overlay's area and the viewport's width at different moments while the window changes size;
    // the controls keep their room throughout instead of seeming to cover the whole difference for a few frames.
    for (const width of [1920, 1440, 1920]) {
      await resize(width)
      await expect.poll(room).toEqual({ viewport: width, overlay: steady, shell: steady })
    }
    expect(await appWindow.evaluate(() => [
      ...(window as Window & { __hronautControlsRoom?: { seen: Set<string> } }).__hronautControlsRoom!.seen
    ])).toEqual([steady])
  } finally {
    await appWindow.evaluate(() => {
      const scope = window as Window & { __hronautControlsRoom?: { stop: () => void } }
      scope.__hronautControlsRoom?.stop()
      delete scope.__hronautControlsRoom
    })
  }
})

test('dims the native window controls with the dialog backdrop and restores them when it closes', async ({
  appWindow,
  electronApp
}) => {
  await electronApp.evaluate(({ BrowserWindow }) => {
    const main = BrowserWindow.getAllWindows().find((window) => window.getTitle() === 'Hronaut')
    if (!main) throw new Error('Missing main window')
    const original = main.setTitleBarOverlay.bind(main)
    ;(main as typeof main & { setTitleBarOverlay: typeof main.setTitleBarOverlay }).setTitleBarOverlay = (options) => {
      ;(globalThis as typeof globalThis & { __hronautTitleBarOverlay?: Electron.TitleBarOverlay }).__hronautTitleBarOverlay = options
      original(options)
    }
  })
  const overlay = () => electronApp.evaluate(() => (
    (globalThis as typeof globalThis & { __hronautTitleBarOverlay?: Electron.TitleBarOverlay }).__hronautTitleBarOverlay
  ))
  const undimmed = { color: '#07160b', symbolColor: '#d9ffe0', height: 44 }
  await appWindow.evaluate('window.hronautSettings.setTheme("matrix")')
  await expect.poll(overlay).toMatchObject(undimmed)

  const dialogs = [
    { open: appWindow.getByRole('button', { name: 'Search tabs' }), dialog: appWindow.locator('.tab-search-panel') },
    { open: appWindow.getByRole('button', { name: 'Create workspace' }), dialog: appWindow.getByRole('dialog', { name: 'Create workspace' }) }
  ]
  for (const { open, dialog } of dialogs) {
    await open.click()
    await expect(dialog).toBeVisible()
    // The backdrop the shell draws under the native controls in the top-right corner.
    const backdrop = parseScrimColor(await appWindow.evaluate(() => {
      let element = document.elementFromPoint(window.innerWidth - 2, 2)
      while (element && getComputedStyle(element).position !== 'fixed') element = element.parentElement
      return element ? getComputedStyle(element).backgroundColor : null
    }))
    expect(backdrop).not.toBeNull()
    const dimmed = dimTitleBarOverlay(undimmed, backdrop)
    expect(dimmed.color).not.toBe(undimmed.color)
    await expect.poll(overlay).toMatchObject({ ...dimmed })

    await appWindow.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await expect.poll(overlay).toMatchObject(undimmed)
  }
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

    // Windows and Linux: the system title bar's auto-hidden menu bar appears when Alt alone is released and hides on
    // the next, once each: Alt with a digit, a workspace key, or with a click shows nothing, and the native menu bar
    // does not toggle a second time. macOS keeps its own menu bar.
    if (process.platform !== 'darwin') {
      const menuBar = () => restarted.app.evaluate(({ BrowserWindow }) => (
        BrowserWindow.getAllWindows().find((window) => window.getTitle() === 'Hronaut')?.isMenuBarVisible()
      ))
      type PressEvent =
        | { type: 'keyDown' | 'keyUp'; keyCode: string; modifiers?: Array<'alt'> }
        | { type: 'mouseDown' | 'mouseUp'; x: number; y: number; button: 'left'; clickCount: number; modifiers?: Array<'alt'> }
      const press = (events: PressEvent[]) => restarted.app.evaluate(({ BrowserWindow }, events) => {
        const main = BrowserWindow.getAllWindows().find((window) => window.getTitle() === 'Hronaut')
        for (const event of events) main?.webContents.sendInputEvent(event)
      }, events)
      await expect.poll(menuBar).toBe(false)
      await press([
        { type: 'keyDown', keyCode: 'Alt' },
        { type: 'mouseDown', x: 4, y: 4, button: 'left', clickCount: 1, modifiers: ['alt'] },
        { type: 'mouseUp', x: 4, y: 4, button: 'left', clickCount: 1, modifiers: ['alt'] },
        { type: 'keyUp', keyCode: 'Alt' },
        { type: 'keyDown', keyCode: 'Alt' },
        { type: 'keyDown', keyCode: '1', modifiers: ['alt'] },
        { type: 'keyUp', keyCode: 'Alt' },
        { type: 'keyUp', keyCode: '1' },
        { type: 'keyDown', keyCode: 'Alt' },
        { type: 'keyUp', keyCode: 'Alt' }
      ])
      await expect.poll(menuBar).toBe(true)
      await press([{ type: 'keyDown', keyCode: 'Alt' }, { type: 'keyUp', keyCode: 'Alt' }])
      await expect.poll(menuBar).toBe(false)
    }

    await restarted.window.getByRole('button', { name: 'Settings' }).click()
    await expect(restarted.window.getByRole('checkbox', { name: 'Use system title bar' })).toBeChecked()
    await expect(restarted.window.getByRole('status')).toHaveCount(0)
  } finally {
    await closeHronaut(restarted.app)
  }
})
