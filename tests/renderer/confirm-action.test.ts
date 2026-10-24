import { afterEach, describe, expect, it, vi } from 'vitest'
import { confirmAction } from '../../src/renderer/src/confirm-action.js'
import type { Confirmation } from '../../src/shared/confirmation.js'

const shellWindow = window as unknown as { hronautShell?: { confirm?: (question: Confirmation) => Promise<boolean> } }

afterEach(() => {
  delete shellWindow.hronautShell
  vi.restoreAllMocks()
})

describe('confirmAction', () => {
  it.each([true, false])('asks main in Hronaut\'s dialog instead of window.confirm when the shell bridge is there (answer=%s)', async (answer) => {
    const confirm = vi.fn(async () => answer)
    const windowConfirm = vi.spyOn(window, 'confirm')
    shellWindow.hronautShell = { confirm }
    const question = { message: 'Remove wallet "Main"?', detail: 'Its keys leave this computer.' }

    await expect(confirmAction(question)).resolves.toBe(answer)

    expect(confirm).toHaveBeenCalledExactlyOnceWith(question)
    expect(windowConfirm).not.toHaveBeenCalled()
  })

  it('answers no to a second question while one waits, without asking it, and asks again once the first is answered', async () => {
    let answer!: (value: boolean) => void
    const confirm = vi.fn(() => new Promise<boolean>((resolve) => { answer = resolve }))
    shellWindow.hronautShell = { confirm }

    const first = confirmAction({ message: 'Clear history?' })
    await expect(confirmAction({ message: 'Clear history?' })).resolves.toBe(false)
    expect(confirm).toHaveBeenCalledOnce()
    answer(true)
    await expect(first).resolves.toBe(true)

    const again = confirmAction({ message: 'Remove wallet "Main"?' })
    expect(confirm).toHaveBeenCalledTimes(2)
    answer(false)
    await expect(again).resolves.toBe(false)
  })

  it('answers no for a question that could not be asked, and asks the next one', async () => {
    const confirm = vi.fn().mockRejectedValueOnce(new Error('bridge gone')).mockResolvedValueOnce(true)
    shellWindow.hronautShell = { confirm }

    await expect(confirmAction({ message: 'Clear history?' })).resolves.toBe(false)
    await expect(confirmAction({ message: 'Clear history?' })).resolves.toBe(true)
  })

  it('falls back to window.confirm without the shell bridge, as in component tests, with the question and what follows', async () => {
    const windowConfirm = vi.spyOn(window, 'confirm').mockReturnValue(true)

    await expect(confirmAction({ message: 'Clear history?', detail: 'Cookies stay.' })).resolves.toBe(true)
    expect(windowConfirm).toHaveBeenCalledExactlyOnceWith('Clear history?\n\nCookies stay.')
    await confirmAction({ message: 'Clear history?' })
    expect(windowConfirm).toHaveBeenLastCalledWith('Clear history?')
  })
})
