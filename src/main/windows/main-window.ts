import type { BrowserWindow } from 'electron'
import type { SavedWindowState, WindowStateStore } from '../window-state.js'
import type { ScrimColor, WindowChromeMode } from '../../shared/title-bar.js'
import type { WindowMaterial } from '../../shared/window-material.js'

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
