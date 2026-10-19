import { screen, type BrowserWindow } from 'electron'
import type { SavedWindowState, WindowStateStore } from '../window-state.js'

interface WindowStatePersistenceHost {
  /** The window whose bounds are saved; read on every use because it opens later and goes when it closes. */
  window(): Pick<BrowserWindow, 'isDestroyed' | 'getNormalBounds' | 'isMaximized' | 'isFullScreen'> | null
  /** The full screen to save when it is not simply the window's, such as while a page holds it; the window's otherwise. */
  fullScreen?(): boolean
  /** The window's state file, once it is open. */
  store(): Pick<WindowStateStore, 'save'> | null
  /** The bounds last seen while the window was open, saved when the window has already gone. */
  lastState(): SavedWindowState | null
  setLastState(state: SavedWindowState | null): void
  /** Prefixes the save failure in the log, such as `[window]`. */
  logPrefix: string
}

/**
 * Saves one window's bounds, maximized and full-screen state 300 ms after it last changed, and at once on `flush`.
 * The main window and the detached panel window each have their own.
 */
export function createWindowStatePersistence(host: WindowStatePersistenceHost): {
  currentState(): SavedWindowState | null
  scheduleSave(): void
  flush(): Promise<void>
} {
  let timer: NodeJS.Timeout | null = null

  function currentState(): SavedWindowState | null {
    if (!host.window() || host.window()!.isDestroyed()) return null
    const bounds = host.window()!.getNormalBounds()
    return {
      bounds,
      displayId: screen.getDisplayMatching(bounds).id,
      maximized: host.window()!.isMaximized(),
      fullScreen: host.fullScreen?.() ?? host.window()!.isFullScreen()
    }
  }

  function scheduleSave(): void {
    if (!host.store()) return
    host.setLastState(currentState() ?? host.lastState())
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      const state = currentState() ?? host.lastState()
      if (state) void host.store()?.save(state).catch((error) => console.error(`${host.logPrefix} Failed to persist state:`, error))
    }, 300)
  }

  async function flush(): Promise<void> {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    const state = currentState() ?? host.lastState()
    if (state) await host.store()?.save(state)
  }

  return { currentState, scheduleSave, flush }
}
