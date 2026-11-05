import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ dialog: {} }))

const { createShellWindows } = await import('../src/main/windows/shell-windows.js')

function shellWindows(window: unknown, workspaceStartupFailure?: Error, panel: unknown = null) {
  const mainWindowRefs: { window: never; showRequested: boolean; stateUntilShown?: { maximized: boolean; fullScreen: boolean } | null } = {
    window: window as never,
    showRequested: false
  }
  const panelWindowRefs: { window: never; stateUntilShown?: { maximized: boolean; fullScreen: boolean } | null } = { window: panel as never }
  const windows = createShellWindows({
    mainWindowRefs,
    panelWindowRefs,
    workspaceStartupFailure: () => workspaceStartupFailure,
    text: (key) => key
  })
  return { windows, mainWindowRefs, panelWindowRefs }
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

  // A detached panel window that has not painted yet opens with the main window, maximized or in full screen as saved.
  it('shows a detached panel window not shown yet as saved along with it, and at its normal size for an agent', () => {
    const calls: string[] = []
    const fake = (name: string) => ({
      isVisible: () => false,
      isMinimized: () => false,
      isDestroyed: () => false,
      maximize: () => calls.push(`${name} maximize`),
      setFullScreen: (value: boolean) => calls.push(`${name} fullScreen ${value}`),
      show: () => calls.push(`${name} show`),
      showInactive: () => calls.push(`${name} showInactive`),
      focus: () => calls.push(`${name} focus`)
    })
    const shown = shellWindows(fake('main'), undefined, fake('panel'))
    shown.panelWindowRefs.stateUntilShown = { maximized: true, fullScreen: true }
    shown.windows.showWindow()
    expect(calls).toEqual(['main show', 'main focus', 'panel maximize', 'panel fullScreen true', 'panel show'])
    expect(shown.panelWindowRefs.stateUntilShown).toBeNull()

    calls.length = 0
    const forAgent = shellWindows(fake('main'), undefined, fake('panel'))
    forAgent.panelWindowRefs.stateUntilShown = { maximized: true, fullScreen: true }
    forAgent.windows.showWindowInactive()
    expect(calls).toEqual(['main showInactive', 'panel showInactive'])
    expect(forAgent.panelWindowRefs.stateUntilShown).toBeNull()
  })

  it('records nothing once saved workspaces failed, whose window stays hidden', () => {
    const { windows, mainWindowRefs } = shellWindows(null, new Error('rejected workspace metadata'))
    windows.showWindow()
    expect(mainWindowRefs.showRequested).toBe(false)
  })
})
