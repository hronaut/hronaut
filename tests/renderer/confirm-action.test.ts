import { afterEach, describe, expect, it, vi } from 'vitest'
import { confirmAction } from '../../src/renderer/src/confirm-action.js'

const shellWindow = window as unknown as { hronautShell?: { confirm?: (message: string) => boolean } }

afterEach(() => {
  delete shellWindow.hronautShell
  vi.restoreAllMocks()
})

describe('confirmAction', () => {
  it.each([true, false])('asks main natively instead of window.confirm when the shell bridge is there (answer=%s)', (answer) => {
    const confirm = vi.fn(() => answer)
    const windowConfirm = vi.spyOn(window, 'confirm')
    shellWindow.hronautShell = { confirm }

    expect(confirmAction('Remove wallet “Main”?')).toBe(answer)

    expect(confirm).toHaveBeenCalledExactlyOnceWith('Remove wallet “Main”?')
    expect(windowConfirm).not.toHaveBeenCalled()
  })

  it('falls back to window.confirm without the shell bridge, as in component tests', () => {
    const windowConfirm = vi.spyOn(window, 'confirm').mockReturnValue(true)

    expect(confirmAction('Clear history?')).toBe(true)
    expect(windowConfirm).toHaveBeenCalledExactlyOnceWith('Clear history?')
  })
})
