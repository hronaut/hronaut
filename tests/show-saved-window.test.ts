import { describe, expect, it } from 'vitest'
import { showSavedWindow, takeStateUntilShown } from '../src/main/windows/show-saved-window.js'

// Electron shows a hidden window to maximize it or to put it in full screen, so with Launch minimized a window saved
// maximized or in full screen opened on screen instead of in the tray.

function mainWindow({ showRequested = false, visible = false } = {}) {
  const calls: string[] = []
  const state = { visible }
  const window = {
    maximize: () => { calls.push('maximize'); state.visible = true },
    setFullScreen: (value: boolean) => { calls.push(`fullScreen ${value}`); state.visible = true },
    show: () => { calls.push('show'); state.visible = true },
    isVisible: () => state.visible,
    isDestroyed: () => false
  }
  const refs: Parameters<typeof showSavedWindow>[0] = { window: window as never, showRequested }
  return { refs, calls, state }
}

describe('the main window at startup', () => {
  it('opens maximized and in full screen as saved', () => {
    const shown = mainWindow()
    showSavedWindow(shown.refs, { maximized: true, fullScreen: true }, false)
    expect(shown.calls).toEqual(['maximize', 'fullScreen true', 'show'])
    expect(shown.refs.stateUntilShown).toBeUndefined()
  })

  it('stays hidden in the tray, keeping its saved state for the person to show it with', () => {
    const hidden = mainWindow()
    showSavedWindow(hidden.refs, { maximized: true, fullScreen: false }, true)
    expect(hidden.calls).toEqual([])
    expect(hidden.state.visible).toBe(false)
    expect(hidden.refs.stateUntilShown).toEqual({ maximized: true, fullScreen: false })
    takeStateUntilShown(hidden.refs)
    expect(hidden.calls).toEqual(['maximize'])
    expect(hidden.refs.stateUntilShown).toBeNull()
    takeStateUntilShown(hidden.refs)
    expect(hidden.calls).toEqual(['maximize'])

    const fullScreen = mainWindow()
    showSavedWindow(fullScreen.refs, { maximized: false, fullScreen: true }, true)
    expect(fullScreen.calls).toEqual([])
    takeStateUntilShown(fullScreen.refs)
    expect(fullScreen.calls).toEqual(['fullScreen true'])
  })

  it('opens as saved when the person asked to see it before its window opened', () => {
    const asked = mainWindow({ showRequested: true })
    showSavedWindow(asked.refs, { maximized: true, fullScreen: false }, true)
    expect(asked.calls).toEqual(['maximize', 'show'])
    expect(asked.refs.stateUntilShown).toBeUndefined()
  })

  // Showing it again would bring back a window the person closed to the tray meanwhile, or take focus from another app.
  it('gives a window the person showed while it started its saved state without showing it again', () => {
    const shownMeanwhile = mainWindow({ visible: true })
    showSavedWindow(shownMeanwhile.refs, { maximized: true, fullScreen: true }, true)
    expect(shownMeanwhile.calls).toEqual(['maximize', 'fullScreen true'])
    expect(shownMeanwhile.refs.stateUntilShown).toBeUndefined()
  })

  it('keeps nothing it need not take', () => {
    const plain = mainWindow()
    showSavedWindow(plain.refs, { maximized: false, fullScreen: false }, true)
    showSavedWindow(plain.refs, null, true)
    expect(plain.calls).toEqual([])
    expect(plain.refs.stateUntilShown).toBeUndefined()
  })
})
