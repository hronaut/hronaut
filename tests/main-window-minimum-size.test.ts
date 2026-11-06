import { expect, it, vi } from 'vitest'

const workArea = { x: 0, y: 0, width: 1280, height: 800 }
vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events')
  return {
    nativeTheme: Object.assign(new EventEmitter(), { themeSource: 'system', shouldUseDarkColors: false }),
    screen: { getDisplayMatching: () => ({ workArea }) }
  }
})
const { applyMainWindowMinimumSize, applyMainWindowMinimumSizeOnRestore, mainWindowMinimumSize } = await import('../src/main/windows/main-window-minimum-size.js')
const { createWindowAppearance } = await import('../src/main/windows/appearance.js')

// The main window could not be narrower than 760 pixels, so it did not fit half of a 1280, 1366 or 1440-pixel screen
// beside another app, as Chrome's does; its shell lays out from 600 CSS pixels, so the minimum follows the interface scale.

type Bounds = { x: number; y: number; width: number; height: number }
type WindowState = { maximized?: boolean; fullScreen?: boolean; minimized?: boolean; frameWidth?: number; normal?: Bounds }

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
    getNormalBounds: () => state.normal ?? current,
    getSize: () => [current.width, current.height],
    // A maximized or full screen window's frame shrinks or goes, so the frame is only there at its normal size.
    getContentSize: () => [current.width - (filling() ? 0 : state.frameWidth ?? 0), current.height],
    setMinimumSize: vi.fn(),
    setBounds: vi.fn((next: Bounds) => { current = next }),
    webContents: { isDestroyed: () => false, setZoomFactor: vi.fn() }
  }
}

const settled = async () => { await new Promise((resolve) => setImmediate(resolve)) }

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

it('keeps a frame measured at the window\'s normal size once it fills its screen', () => {
  const window = fakeWindow({ x: 0, y: 0, width: 800, height: 700 }, { frameWidth: 16 })
  applyMainWindowMinimumSize(window as never, 1)
  expect(window.setMinimumSize).toHaveBeenLastCalledWith(616, 520)
  window.state.fullScreen = true
  window.move({ x: 0, y: 0, width: 1280, height: 800 })
  applyMainWindowMinimumSize(window as never, 1.25)
  expect(window.setMinimumSize).toHaveBeenLastCalledWith(766, 520)
})

it('grows a window restored narrower than a scale chosen while it filled its screen, once the system restored it', async () => {
  const normal = { x: 40, y: 0, width: 620, height: 700 }
  const window = fakeWindow({ x: 0, y: 0, width: 1280, height: 800 }, { maximized: true, normal })
  applyMainWindowMinimumSize(window as never, 1.25)
  expect(window.setBounds).not.toHaveBeenCalled()
  // Windows says the window left full screen, or was restored, before it has its size back.
  applyMainWindowMinimumSizeOnRestore(window as never, () => 1.25)
  window.state.maximized = false
  window.move(normal)
  await settled()
  expect(window.setBounds).toHaveBeenCalledWith({ x: 40, y: 0, width: 750, height: 700 })
})

it('keeps on its screen a window the system itself grew to the new minimum as it was restored', async () => {
  const window = fakeWindow({ x: 0, y: 0, width: 1280, height: 800 }, { maximized: true, normal: { x: 600, y: 0, width: 660, height: 700 } })
  applyMainWindowMinimumSize(window as never, 1.25)
  applyMainWindowMinimumSizeOnRestore(window as never, () => 1.25)
  window.state.maximized = false
  window.move({ x: 600, y: 0, width: 750, height: 700 })
  await settled()
  expect(window.setBounds).toHaveBeenCalledWith({ x: 530, y: 0, width: 750, height: 700 })

  // A window the person left past its screen's edge, with no new minimum, stays where they left it.
  const placed = fakeWindow({ x: 900, y: 0, width: 750, height: 700 })
  applyMainWindowMinimumSizeOnRestore(placed as never, () => 1.25)
  await settled()
  expect(placed.setBounds).not.toHaveBeenCalled()
})

it('moves a grown window only as far as growing pushed it, and only along the side that grew', () => {
  const low = fakeWindow({ x: -100, y: 400, width: 620, height: 700 })
  applyMainWindowMinimumSize(low as never, 1.25)
  expect(low.setBounds).toHaveBeenCalledWith({ x: -100, y: 400, width: 750, height: 700 })
})

it('does not resize a maximized, full screen or minimized window', () => {
  for (const state of [{ maximized: true }, { fullScreen: true }, { minimized: true }]) {
    const window = fakeWindow({ x: 0, y: 0, width: 620, height: 700 }, state)
    applyMainWindowMinimumSize(window as never, 1.25)
    expect(window.setMinimumSize).toHaveBeenCalledWith(750, 520)
    expect(window.setBounds).not.toHaveBeenCalled()
  }
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
