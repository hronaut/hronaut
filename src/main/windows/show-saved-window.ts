import type { BrowserWindow } from 'electron'
import type { SavedWindowState } from '../window-state.js'
import type { MainWindowRefs } from './main-window.js'

type ShownWindow = Pick<BrowserWindow, 'maximize' | 'setFullScreen' | 'show' | 'isVisible' | 'isDestroyed'>
type WindowShowState = Pick<SavedWindowState, 'maximized' | 'fullScreen'>
type ShownWindowRefs = Pick<MainWindowRefs, 'showRequested' | 'stateUntilShown'> & { window: ShownWindow | null }

/**
 * Shows the main window as it was saved, maximized or in full screen, unless it starts hidden in the tray and the
 * person has not asked to see it. Electron shows a hidden window to maximize it or to put it in full screen, so a
 * window that starts hidden keeps that state for the person's first show (`takeStateUntilShown`), and until then that
 * state is the one saved again. A window the person already showed while startup ran, as by opening Hronaut again,
 * takes the saved state then and is not shown again.
 */
export function showSavedWindow(refs: ShownWindowRefs, saved: WindowShowState | null, startsHidden: boolean): void {
  const window = refs.window
  if (!window) return
  if (!startsHidden || refs.showRequested) {
    takeShowState(window, saved)
    window.show()
    return
  }
  if (window.isVisible()) {
    takeShowState(window, saved)
    return
  }
  if (!saved?.maximized && !saved?.fullScreen) return
  refs.stateUntilShown = { maximized: saved.maximized, fullScreen: saved.fullScreen }
}

/**
 * Gives a window the maximized or full screen state it kept until it is shown: the main window from a hidden start, as
 * the person shows it, or a detached panel window when it first appears. Taken before the window is shown, it opens
 * that way at once, since Electron shows a hidden window to take it.
 */
export function takeStateUntilShown(refs: Pick<ShownWindowRefs, 'window' | 'stateUntilShown'>): void {
  const state = refs.stateUntilShown
  if (!state) return
  refs.stateUntilShown = null
  if (refs.window && !refs.window.isDestroyed()) takeShowState(refs.window, state)
}

function takeShowState(window: ShownWindow, state: WindowShowState | null): void {
  if (state?.maximized) window.maximize()
  if (state?.fullScreen) window.setFullScreen(true)
}
