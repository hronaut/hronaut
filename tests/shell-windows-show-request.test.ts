import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ dialog: {} }))

const { createShellWindows } = await import('../src/main/windows/shell-windows.js')

function shellWindows(window: unknown, workspaceStartupFailure?: Error) {
  const mainWindowRefs = { window: window as never, showRequested: false }
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

  it('records nothing once saved workspaces failed, whose window stays hidden', () => {
    const { windows, mainWindowRefs } = shellWindows(null, new Error('rejected workspace metadata'))
    windows.showWindow()
    expect(mainWindowRefs.showRequested).toBe(false)
  })
})
