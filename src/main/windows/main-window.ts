import { BrowserWindow, Menu, nativeTheme, screen } from 'electron'
import { release as osRelease } from 'node:os'
import { join } from 'node:path'
import { restoreWindowBounds, type SavedWindowState, type WindowStateStore } from '../window-state.js'
import { applyWindowMaterial } from '../window-material.js'
import {
  dimTitleBarOverlay,
  createAutoHideMenuGesture,
  mainWindowChromeOptions,
  titleBarOverlayStyle,
  type DesktopWindowPlatform,
  type ScrimColor,
  type WindowChromeMode
} from '../../shared/title-bar.js'
import { windowMaterialFor, windowMaterialOptions, type WindowMaterial } from '../../shared/window-material.js'
import type { ResolvedThemeName } from '../../shared/theme.js'
import type { AppSettings, ThemeName } from '../../shared/types.js'

/**
 * The main window and what it was opened with, created once by index.ts. The window opens after startup and closes
 * when the person quits or closes it; every reader reads the fields when it runs, so it always sees the current window.
 */
export interface MainWindowRefs {
  /** The main window, from when it opens until it closes. */
  window: BrowserWindow | null
  /** Whether the shell draws its own title bar beside overlaid native controls, or the system draws one. */
  chromeMode: WindowChromeMode
  /** The backdrop of the dialog open in the main window, laid over the native window controls. */
  controlsScrim: ScrimColor | null
  /** The material showing behind the main window's tab rail, or null for the theme's solid surface. */
  material: WindowMaterial | null
  /** The file the main window's bounds are saved in, once the window opened. */
  stateStore: WindowStateStore | null
  /** The bounds the main window last had, which before-quit records too. */
  lastState: SavedWindowState | null
}

interface MainWindowHost {
  /** The main window and what it was opened with; index.ts creates the record, and most of the main process reads it. */
  refs: MainWindowRefs
  /** The current settings; read on every use because each committed update replaces them. */
  settings(): Pick<AppSettings, 'theme' | 'tabPosition' | 'interfaceScale' | 'useSystemTitleBar'>
  resolvedTheme(theme: ThemeName): ResolvedThemeName
  /** Each theme's window background. */
  themeBackground: Record<ResolvedThemeName, string>
  /** Quiets an open request for the person's attention once they press a key or click in the shell. */
  acknowledgeUserAttention(): void
}

/**
 * The main window's own chrome: opening it with its saved bounds, its title bar and the material behind its tab rail,
 * keeping the title bar overlay and material in step with the theme and the dialog backdrop, and showing the menu bar
 * when the person presses Alt alone.
 */
export function createMainWindow(host: MainWindowHost): {
  openMainWindow(savedWindowState: SavedWindowState | null): BrowserWindow
  attachMenuBarGesture(): void
  clearWindowControlsScrim(): void
  applyMainWindowTitleBarOverlay(): void
  applyMainWindowBackground(): void
} {
  function desktopWindowPlatform(): DesktopWindowPlatform {
    if (process.platform === 'darwin' || process.platform === 'win32') return process.platform
    return 'linux'
  }

  function clearWindowControlsScrim(): void {
    if (!host.refs.controlsScrim) return
    host.refs.controlsScrim = null
    applyMainWindowTitleBarOverlay()
  }

  function applyMainWindowTitleBarOverlay(): void {
    if (
      host.refs.chromeMode !== 'overlay'
      || process.platform === 'darwin'
      || !host.refs.window
      || host.refs.window.isDestroyed()
    ) return
    host.refs.window.setTitleBarOverlay(dimTitleBarOverlay(titleBarOverlayStyle(
      host.resolvedTheme(host.settings().theme),
      host.settings().tabPosition,
      host.settings().interfaceScale
    ), host.refs.controlsScrim))
  }

  /** The material behind the main window's tab rail for the current settings and system, if any. */
  function currentWindowMaterial(): WindowMaterial | null {
    return windowMaterialFor({
      platform: desktopWindowPlatform(),
      osRelease: osRelease(),
      theme: host.resolvedTheme(host.settings().theme),
      tabPosition: host.settings().tabPosition,
      chrome: host.refs.chromeMode,
      reducedTransparency: nativeTheme.prefersReducedTransparency,
      forcedColors: nativeTheme.inForcedColorsMode || nativeTheme.shouldUseHighContrastColors
    })
  }

  /** Shows or removes the material behind the main window's rail; the shell learns the result from its renderer state. */
  function applyMainWindowBackground(): void {
    host.refs.material = applyWindowMaterial(host.refs.window, process.platform, host.refs.material, currentWindowMaterial(), host.themeBackground[host.resolvedTheme(host.settings().theme)])
  }

  /** Opens the main window, hidden, with the saved bounds, title bar and material the settings choose. */
  function openMainWindow(savedWindowState: SavedWindowState | null): BrowserWindow {
    const displays = screen.getAllDisplays()
    const primaryDisplay = screen.getPrimaryDisplay()
    const orderedDisplays = [primaryDisplay, ...displays.filter((display) => display.id !== primaryDisplay.id)]
    const bounds = restoreWindowBounds(savedWindowState, orderedDisplays, { width: 1320, height: 860 })
    host.refs.chromeMode = host.settings().useSystemTitleBar ? 'system' : 'overlay'
    const windowChromeOptions = mainWindowChromeOptions({
      platform: desktopWindowPlatform(),
      useSystemTitleBar: host.settings().useSystemTitleBar,
      theme: host.resolvedTheme(host.settings().theme),
      tabPosition: host.settings().tabPosition,
      interfaceScale: host.settings().interfaceScale
    })
    host.refs.material = currentWindowMaterial()
    return new BrowserWindow({
      ...bounds,
      ...windowChromeOptions,
      minWidth: 760,
      minHeight: 520,
      show: false,
      title: 'Hronaut',
      backgroundColor: host.themeBackground[host.resolvedTheme(host.settings().theme)],
      ...windowMaterialOptions(host.refs.material),
      webPreferences: {
        preload: join(__dirname, '../preload/index.cjs'),
        additionalArguments: [
          '--hronaut-window-kind=main',
          `--hronaut-window-chrome=${host.refs.chromeMode}`
        ],
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    })
  }

  /** Shows the menu bar, or pops the menu up under an overlaid title bar, when Alt is pressed and released alone. */
  function attachMenuBarGesture(): void {
    const autoHideMenuGesture = createAutoHideMenuGesture(desktopWindowPlatform())
    // Alt with a click, an Alt-drag of the window or a switch away from it is not Alt alone.
    host.refs.window!.on('blur', autoHideMenuGesture.reset)
    host.refs.window!.on('move', autoHideMenuGesture.reset)
    host.refs.window!.webContents.on('blur', autoHideMenuGesture.reset)
    host.refs.window!.webContents.on('before-input-event', (event, input) => {
      if (input.type === 'keyDown' || input.type === 'rawKeyDown') host.acknowledgeUserAttention()
      const menuGesture = autoHideMenuGesture(input)
      if (menuGesture) event.preventDefault()
      if (host.refs.window && menuGesture === 'toggle') {
        if (host.refs.chromeMode === 'overlay') {
          Menu.getApplicationMenu()?.popup({
            window: host.refs.window,
            x: 8,
            y: titleBarOverlayStyle(
              host.resolvedTheme(host.settings().theme),
              host.settings().tabPosition,
              host.settings().interfaceScale
            ).height
          })
        } else {
          host.refs.window.setMenuBarVisibility(!host.refs.window.isMenuBarVisible())
        }
      }
    })
    host.refs.window!.webContents.on('before-mouse-event', (_event, mouse) => {
      if (mouse.type === 'mouseDown' || mouse.type === 'contextMenu') {
        host.acknowledgeUserAttention()
        autoHideMenuGesture.reset()
      }
    })
  }

  return { openMainWindow, attachMenuBarGesture, clearWindowControlsScrim, applyMainWindowTitleBarOverlay, applyMainWindowBackground }
}
