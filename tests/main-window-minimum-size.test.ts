import { expect, it, vi } from 'vitest'

vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events')
  return { nativeTheme: Object.assign(new EventEmitter(), { themeSource: 'system', shouldUseDarkColors: false }) }
})
const { applyMainWindowMinimumSize, mainWindowMinimumSize } = await import('../src/main/windows/main-window-minimum-size.js')
const { createWindowAppearance } = await import('../src/main/windows/appearance.js')

// The main window could not be narrower than 760 pixels, so it did not fit half of a 1280, 1366 or 1440-pixel screen
// beside another app, as Chrome's does; its shell lays out from 600 CSS pixels, so the minimum follows the interface scale.

function fakeWindow(size: [number, number], state: { maximized?: boolean; fullScreen?: boolean } = {}) {
  let current = size
  return {
    isDestroyed: () => false,
    isMaximized: () => state.maximized ?? false,
    isFullScreen: () => state.fullScreen ?? false,
    getSize: () => current,
    setMinimumSize: vi.fn(),
    setSize: vi.fn((width: number, height: number) => {
      current = [width, height]
    }),
    webContents: { isDestroyed: () => false, setZoomFactor: vi.fn() }
  }
}

it('keeps the shell at 600 CSS pixels wide at every interface scale', () => {
  expect(mainWindowMinimumSize(1)).toEqual({ width: 600, height: 520 })
  expect(mainWindowMinimumSize(1.1)).toEqual({ width: 660, height: 520 })
  expect(mainWindowMinimumSize(1.25)).toEqual({ width: 750, height: 520 })
})

it('grows a window narrower than a larger interface needs, and leaves a wider one as it is', () => {
  const narrow = fakeWindow([620, 700])
  applyMainWindowMinimumSize(narrow as never, 1.25)
  expect(narrow.setMinimumSize).toHaveBeenCalledWith(750, 520)
  expect(narrow.setSize).toHaveBeenCalledWith(750, 700)

  const wide = fakeWindow([1320, 860])
  applyMainWindowMinimumSize(wide as never, 1.25)
  expect(wide.setMinimumSize).toHaveBeenCalledWith(750, 520)
  expect(wide.setSize).not.toHaveBeenCalled()

  const smaller = fakeWindow([750, 700])
  applyMainWindowMinimumSize(smaller as never, 1)
  expect(smaller.setMinimumSize).toHaveBeenCalledWith(600, 520)
  expect(smaller.setSize).not.toHaveBeenCalled()
})

it('does not resize a maximized or full screen window', () => {
  for (const state of [{ maximized: true }, { fullScreen: true }]) {
    const window = fakeWindow([620, 700], state)
    applyMainWindowMinimumSize(window as never, 1.25)
    expect(window.setMinimumSize).toHaveBeenCalledWith(750, 520)
    expect(window.setSize).not.toHaveBeenCalled()
  }
})

it('gives the main window the minimum size of a new interface scale', () => {
  const mainWindow = fakeWindow([620, 700])
  const appearance = createWindowAppearance({
    mainWindowRefs: { window: mainWindow as never },
    panelWindowRefs: { window: null },
    settings: () => ({ theme: 'system' }),
    applyMainWindowBackground: vi.fn(),
    applyMainWindowTitleBarOverlay: vi.fn(),
    addressSuggestionOverlay: { setZoomFactor: vi.fn() },
    toastOverlay: { relayout: vi.fn() },
    sidebarOverlay: { relayout: vi.fn() },
    statusBubble: { layoutChanged: vi.fn() },
    sendToShellWindows: vi.fn(),
    currentRendererSettingsState: () => ({}) as never
  })
  appearance.applyInterfaceScale(1.1 as never)
  expect(mainWindow.webContents.setZoomFactor).toHaveBeenCalledWith(1.1)
  expect(mainWindow.setMinimumSize).toHaveBeenCalledWith(660, 520)
  expect(mainWindow.setSize).toHaveBeenCalledWith(660, 700)
})
