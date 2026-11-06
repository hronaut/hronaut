import { expect, it, vi } from 'vitest'

const workArea = { x: 0, y: 0, width: 1280, height: 776 }
const displayBounds = { x: 0, y: 0, width: 1280, height: 800 }
vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events')
  return {
    nativeTheme: Object.assign(new EventEmitter(), { themeSource: 'system', shouldUseDarkColors: false }),
    screen: { getDisplayMatching: () => ({ workArea, bounds: displayBounds }) }
  }
})
const { applyMainWindowMinimumSize, applyWaitingMainWindowMinimumSize, mainWindowMinimumSize } = await import('../src/main/windows/main-window-minimum-size.js')
const { createWindowAppearance } = await import('../src/main/windows/appearance.js')

// The main window could not be narrower than 760 pixels, so it did not fit half of a 1280, 1366 or 1440-pixel screen
// beside another app, as Chrome's does; its shell lays out from 600 CSS pixels, so the minimum follows the interface scale.

type Bounds = { x: number; y: number; width: number; height: number }
type WindowState = { maximized?: boolean; fullScreen?: boolean; minimized?: boolean; frameWidth?: number }

function fakeWindow(bounds: Bounds, state: WindowState = {}) {
  let current = bounds
  const filling = () => Boolean(state.maximized || state.fullScreen)
  return {
    state,
    move: (next: Bounds) => { current = next },
    isDestroyed: () => false,
    isMaximized: () => state.maximized ?? false,
    isFullScreen: () => state.fullScreen ?? false,
    isMinimized: () => state.minimized ?? false,
    getBounds: () => current,
    getSize: () => [current.width, current.height],
    // A maximized or full screen window's frame shrinks or goes, so the frame is only there at its normal size.
    getContentSize: () => [current.width - (filling() ? 0 : state.frameWidth ?? 0), current.height],
    setMinimumSize: vi.fn(),
    setBounds: vi.fn((next: Bounds) => { current = next }),
    webContents: { isDestroyed: () => false, setZoomFactor: vi.fn() }
  }
}

it('keeps the shell at 600 CSS pixels wide at every interface scale', () => {
  expect(mainWindowMinimumSize(1)).toEqual({ width: 600, height: 520 })
  expect(mainWindowMinimumSize(1.1)).toEqual({ width: 660, height: 520 })
  expect(mainWindowMinimumSize(1.25)).toEqual({ width: 750, height: 520 })
})

it('grows a window narrower than a larger interface needs, and leaves a wider one as it is', () => {
  const narrow = fakeWindow({ x: 20, y: 30, width: 620, height: 700 })
  applyMainWindowMinimumSize(narrow as never, 1.25)
  expect(narrow.setMinimumSize).toHaveBeenCalledWith(750, 520)
  expect(narrow.setBounds).toHaveBeenCalledWith({ x: 20, y: 30, width: 750, height: 700 })

  const wide = fakeWindow({ x: 0, y: 0, width: 1320, height: 860 })
  applyMainWindowMinimumSize(wide as never, 1.25)
  expect(wide.setMinimumSize).toHaveBeenCalledWith(750, 520)
  expect(wide.setBounds).not.toHaveBeenCalled()

  const smaller = fakeWindow({ x: 0, y: 0, width: 750, height: 700 })
  applyMainWindowMinimumSize(smaller as never, 1)
  expect(smaller.setMinimumSize).toHaveBeenCalledWith(600, 520)
  expect(smaller.setBounds).not.toHaveBeenCalled()
})

it('keeps a grown window on its screen, as one snapped to the right half', () => {
  const rightHalf = fakeWindow({ x: 640, y: 0, width: 640, height: 800 })
  applyMainWindowMinimumSize(rightHalf as never, 1.25)
  expect(rightHalf.setBounds).toHaveBeenCalledWith({ x: 530, y: 0, width: 750, height: 800 })
})

it('leaves room for a system title bar\'s frame, so the shell keeps its width', () => {
  const framed = fakeWindow({ x: 0, y: 0, width: 608, height: 700 }, { frameWidth: 16 })
  applyMainWindowMinimumSize(framed as never, 1)
  expect(framed.setMinimumSize).toHaveBeenCalledWith(616, 520)
  expect(framed.setBounds).toHaveBeenCalledWith({ x: 0, y: 0, width: 616, height: 700 })
})

it('waits for a maximized, full screen or minimized window to have its own size, and measures its frame then', () => {
  for (const state of [{ maximized: true }, { fullScreen: true }, { minimized: true }]) {
    const normal = { x: 40, y: 0, width: 620, height: 700 }
    const window = fakeWindow(state.minimized ? normal : { ...workArea }, { ...state, frameWidth: 16 })
    applyMainWindowMinimumSize(window as never, 1.25)
    expect(window.setMinimumSize).not.toHaveBeenCalled()
    expect(window.setBounds).not.toHaveBeenCalled()
    // Still filling its screen, or minimized, it waits on.
    applyWaitingMainWindowMinimumSize(window as never, 1.25)
    expect(window.setMinimumSize).not.toHaveBeenCalled()

    Object.assign(window.state, { maximized: false, fullScreen: false, minimized: false })
    window.move(normal)
    applyWaitingMainWindowMinimumSize(window as never, 1.25)
    expect(window.setMinimumSize).toHaveBeenCalledWith(766, 520)
    expect(window.setBounds).toHaveBeenCalledWith({ x: 40, y: 0, width: 766, height: 700 })
    // Applied once: a later resize leaves it to the minimum.
    applyWaitingMainWindowMinimumSize(window as never, 1.25)
    expect(window.setMinimumSize).toHaveBeenCalledOnce()
  }
})

it('waits on while a window that left maximized or full screen still fills its screen, as a window manager can say first', () => {
  for (const area of [workArea, displayBounds]) {
    const window = fakeWindow({ ...area }, { maximized: true })
    applyMainWindowMinimumSize(window as never, 1.25)
    window.state.maximized = false
    applyWaitingMainWindowMinimumSize(window as never, 1.25)
    expect(window.setMinimumSize).not.toHaveBeenCalled()
    // The resize that gives it its size back applies it, keeping it on its screen.
    window.move({ x: 600, y: 0, width: 660, height: 700 })
    applyWaitingMainWindowMinimumSize(window as never, 1.25)
    expect(window.setBounds).toHaveBeenCalledWith({ x: 530, y: 0, width: 750, height: 700 })
  }
})

it('takes the scale chosen last, so one lowered again while the window was maximized moves nothing', () => {
  const window = fakeWindow({ ...workArea }, { maximized: true })
  applyMainWindowMinimumSize(window as never, 1.25)
  applyMainWindowMinimumSize(window as never, 1)
  window.state.maximized = false
  window.move({ x: 760, y: 0, width: 620, height: 700 })
  applyWaitingMainWindowMinimumSize(window as never, 1)
  expect(window.setMinimumSize).toHaveBeenCalledWith(600, 520)
  expect(window.setBounds).not.toHaveBeenCalled()
})

it('leaves a window with nothing waiting alone, wherever the person placed it', () => {
  const placed = fakeWindow({ x: 900, y: 0, width: 620, height: 700 })
  applyWaitingMainWindowMinimumSize(placed as never, 1.25)
  expect(placed.setMinimumSize).not.toHaveBeenCalled()
  expect(placed.setBounds).not.toHaveBeenCalled()
})

it('moves a grown window only as far as growing pushed it, and only along the side that grew', () => {
  const low = fakeWindow({ x: -100, y: 400, width: 620, height: 700 })
  applyMainWindowMinimumSize(low as never, 1.25)
  expect(low.setBounds).toHaveBeenCalledWith({ x: -100, y: 400, width: 750, height: 700 })
})

it('gives the main window the minimum size of a new interface scale', () => {
  const mainWindow = fakeWindow({ x: 0, y: 0, width: 620, height: 700 })
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
  expect(mainWindow.setBounds).toHaveBeenCalledWith({ x: 0, y: 0, width: 660, height: 700 })
})
