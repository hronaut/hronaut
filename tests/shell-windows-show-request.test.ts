import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ dialog: {} }))

const { createShellWindows } = await import('../src/main/windows/shell-windows.js')

function shellWindows(window: unknown, workspaceStartupFailure?: Error) {
  const mainWindowRefs: { window: never; showRequested: boolean; stateUntilShown?: { maximized: boolean; fullScreen: boolean } | null } = {
    window: window as never,
    showRequested: false
  }
  const windows = createShellWindows({
    mainWindowRefs,
    panelWindowRefs: { window: null },
    workspaceStartupFailure: () => workspaceStartupFailure,
    text: (key) => key
  })
  return { windows, mainWindowRefs }
}

describe('showing the main window', () => {
  it('remembers a show asked for while Hronaut starts, before its window opened, for startup to honor', () => {
    // As opening Hronaut again does while the first launch, started hidden in the tray at sign-in, is still starting.
    const { windows, mainWindowRefs } = shellWindows(null)
    windows.showWindow()
    expect(mainWindowRefs.showRequested).toBe(true)
  })

  it('shows and focuses a window that opened, without recording anything', () => {
    const window = { isMinimized: () => true, restore: vi.fn(), show: vi.fn(), focus: vi.fn() }
    const { windows, mainWindowRefs } = shellWindows(window)
    windows.showWindow()
    expect(window.restore).toHaveBeenCalledOnce()
    expect(window.show).toHaveBeenCalledOnce()
    expect(window.focus).toHaveBeenCalledOnce()
    expect(mainWindowRefs.showRequested).toBe(false)
  })

  // Electron shows a hidden window to maximize it, so a window saved maximized opened on screen at sign-in, from the tray.
  it('opens a window that started hidden in the tray maximized as saved once the person shows it', () => {
    const calls: string[] = []
    const window = {
      isMinimized: () => false,
      isDestroyed: () => false,
      maximize: () => calls.push('maximize'),
      setFullScreen: (value: boolean) => calls.push(`fullScreen ${value}`),
      show: () => calls.push('show'),
      focus: () => calls.push('focus')
    }
    const { windows, mainWindowRefs } = shellWindows(window)
    mainWindowRefs.stateUntilShown = { maximized: true, fullScreen: false }
    windows.showWindow()
    windows.showWindow()
    expect(calls).toEqual(['maximize', 'show', 'focus', 'show', 'focus'])
    expect(mainWindowRefs.stateUntilShown).toBeNull()
  })

  it('shows a window that started hidden at its normal size for an agent, which takes no focus, and drops its kept state', () => {
    const window = { isVisible: () => false, isMinimized: () => false, showInactive: vi.fn(), maximize: vi.fn(), setFullScreen: vi.fn() }
    const { windows, mainWindowRefs } = shellWindows(window)
    mainWindowRefs.stateUntilShown = { maximized: true, fullScreen: true }
    windows.showWindowInactive()
    expect(window.showInactive).toHaveBeenCalledOnce()
    expect(window.maximize).not.toHaveBeenCalled()
    expect(window.setFullScreen).not.toHaveBeenCalled()
    expect(mainWindowRefs.stateUntilShown).toBeNull()
  })

  it('records nothing once saved workspaces failed, whose window stays hidden', () => {
    const { windows, mainWindowRefs } = shellWindows(null, new Error('rejected workspace metadata'))
    windows.showWindow()
    expect(mainWindowRefs.showRequested).toBe(false)
  })
})
