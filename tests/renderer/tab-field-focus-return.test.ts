import { effectScope, nextTick, ref, shallowRef } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { useTabFieldFocusReturn } from '../../src/renderer/src/features/tabs/useTabFieldFocusReturn.js'
import type { ShellTabField } from '../../src/shared/tab-field.js'

// Switching tabs gave the page the keyboard. As Chrome gives a tab its focused view back, the shell tells main which
// field of the shown tab has the keyboard, and gives it back when main shows the tab again.
describe('giving a tab\'s field the keyboard back', () => {
  function setup(options: { returnFocus?: boolean; returnFindFocus?: boolean } = {}) {
    const state = shallowRef<{ activeTabId: string | null }>({ activeTabId: 'second' })
    /** Main's next state, showing this tab. */
    const show = (tabId: string) => { state.value = { activeTabId: tabId } }
    const focusedField = ref<ShellTabField | null>(null)
    let returned: ((tabId: string, field: ShellTabField) => void) | undefined
    let givenBack: (() => void) | undefined
    const stopListening = vi.fn()
    const stopKeyboardListening = vi.fn()
    const shell = {
      setTabFieldFocused: vi.fn(),
      onTabFieldFocusReturned: vi.fn((listener: (tabId: string, field: ShellTabField) => void) => {
        returned = listener
        return stopListening
      }),
      onKeyboardGivenBack: vi.fn((listener: () => void) => {
        givenBack = listener
        return stopKeyboardListening
      })
    }
    const address = {
      expectFocusReturn: vi.fn(),
      cancelFocusReturn: vi.fn(),
      returnFocus: vi.fn((_tabId: string) => options.returnFocus ?? true)
    }
    const returnFindFocus = vi.fn((_tabId: string) => options.returnFindFocus ?? true)
    const focusPage = vi.fn()
    const scope = effectScope()
    const stop = scope.run(() => useTabFieldFocusReturn({
      shell,
      browserState: () => state.value,
      focusedField: () => focusedField.value,
      address,
      returnFindFocus,
      focusPage
    }))!
    return {
      show, focusedField, shell, address, returnFindFocus, focusPage, stopListening, stopKeyboardListening,
      returned: (tabId: string, field: ShellTabField) => returned!(tabId, field),
      givenBack: () => givenBack!(),
      stop: () => { stop(); scope.stop() }
    }
  }

  it('tells main at once which field has the keyboard', () => {
    const { focusedField, shell, stop } = setup()
    try {
      expect(shell.setTabFieldFocused).toHaveBeenCalledExactlyOnceWith(null)
      focusedField.value = 'address'
      // In the same turn, before a tab the same key selects is left.
      expect(shell.setTabFieldFocused).toHaveBeenLastCalledWith('address')
      focusedField.value = 'find'
      focusedField.value = null
      expect(shell.setTabFieldFocused.mock.calls).toEqual([[null], ['address'], ['find'], [null]])
    } finally { stop() }
  })

  // A tab's row took the keyboard on the press of the click that selected another tab, so main heard of no field before
  // the tab was left, and the tab gave its page the keyboard when shown again. Chrome's tabs take no keyboard.
  it('tells main the field that had the keyboard until a click on a tab\'s row is over', () => {
    const { focusedField, shell, stop } = setup()
    const row = document.createElement('button')
    row.setAttribute('role', 'tab')
    row.dataset.tabId = 'first'
    row.append(document.createElement('span'))
    const other = document.createElement('button')
    document.body.append(row, other)
    const pointer = (target: Element, type: string, button = 0) => target.dispatchEvent(new MouseEvent(type, { bubbles: true, button }))
    try {
      vi.useFakeTimers()
      focusedField.value = 'address'
      shell.setTabFieldFocused.mockClear()
      // The press on the row, on its title, takes the keyboard from the field; the click then selects the tab.
      pointer(row.firstElementChild!, 'pointerdown')
      focusedField.value = null
      pointer(row, 'pointerup')
      expect(shell.setTabFieldFocused).not.toHaveBeenCalled()
      vi.runAllTimers()
      expect(shell.setTabFieldFocused.mock.calls).toEqual([[null]])

      // A row dragged away is not clicked, nor one whose menu opens, as with Ctrl and the click on macOS: the menu
      // takes the end of the press.
      for (const end of ['pointercancel', 'contextmenu', 'blur']) {
        focusedField.value = 'find'
        shell.setTabFieldFocused.mockClear()
        pointer(row, 'pointerdown')
        focusedField.value = null
        if (end === 'blur') window.dispatchEvent(new FocusEvent('blur'))
        else pointer(row, end)
        expect(shell.setTabFieldFocused.mock.calls, end).toEqual([[null]])
      }

      // A field the selected tab gives the keyboard back to is told at once.
      focusedField.value = 'address'
      shell.setTabFieldFocused.mockClear()
      pointer(row, 'pointerdown')
      focusedField.value = null
      focusedField.value = 'find'
      expect(shell.setTabFieldFocused.mock.calls).toEqual([['find']])
      pointer(row, 'pointerup')
      vi.runAllTimers()
      expect(shell.setTabFieldFocused.mock.calls).toEqual([['find']])

      // A press on a row with no field holding the keyboard tells main nothing.
      focusedField.value = null
      shell.setTabFieldFocused.mockClear()
      pointer(row, 'pointerdown')
      pointer(row, 'pointerup')
      vi.runAllTimers()
      expect(shell.setTabFieldFocused).not.toHaveBeenCalled()

      // A press with another button, which opens the row's menu or closes its tab, and a press anywhere else, as on a
      // button beside the tabs, take the field at once.
      for (const [target, button] of [[row, 2], [row, 1], [other, 0]] as const) {
        focusedField.value = 'address'
        shell.setTabFieldFocused.mockClear()
        pointer(target, 'pointerdown', button)
        focusedField.value = null
        expect(shell.setTabFieldFocused.mock.calls, `button ${button}`).toEqual([[null]])
        pointer(target, 'pointerup', button)
        vi.runAllTimers()
        expect(shell.setTabFieldFocused.mock.calls, `button ${button}`).toEqual([[null]])
      }
    } finally {
      stop()
      row.remove()
      other.remove()
      vi.useRealTimers()
    }
  })

  it('gives the address field the keyboard back once the tab is shown, keeping its suggestions closed until then', async () => {
    const { show, address, focusPage, returned, stop } = setup()
    try {
      // Main says so before the shell shows the tab.
      returned('first', 'address')
      expect(address.expectFocusReturn).toHaveBeenCalledOnce()
      await nextTick()
      expect(address.returnFocus).not.toHaveBeenCalled()
      show('first')
      await nextTick()
      await nextTick()
      expect(address.returnFocus).toHaveBeenCalledExactlyOnceWith('first')
      expect(focusPage).not.toHaveBeenCalled()

      // Or once the tab is already shown.
      show('second')
      await nextTick()
      returned('second', 'address')
      await nextTick()
      expect(address.returnFocus).toHaveBeenLastCalledWith('second')
      expect(address.returnFocus).toHaveBeenCalledTimes(2)
    } finally { stop() }
  })

  it('gives Find\'s field the keyboard back, and the page when the field cannot take it', async () => {
    const { show, address, returnFindFocus, focusPage, returned, stop } = setup({ returnFindFocus: false })
    try {
      returned('first', 'find')
      show('first')
      await nextTick()
      await nextTick()
      expect(address.cancelFocusReturn).toHaveBeenCalledOnce()
      expect(address.returnFocus).not.toHaveBeenCalled()
      expect(returnFindFocus).toHaveBeenCalledExactlyOnceWith('first')
      // Find did not come back with the tab, such as after its page went to another.
      expect(focusPage).toHaveBeenCalledOnce()
    } finally { stop() }
  })

  it('gives the page the keyboard when the address field cannot take it', async () => {
    const { show, focusPage, returned, stop } = setup({ returnFocus: false })
    try {
      show('first')
      await nextTick()
      returned('first', 'address')
      await nextTick()
      expect(focusPage).toHaveBeenCalledOnce()
    } finally { stop() }
  })

  it('gives nothing back when another tab is shown first', async () => {
    const { show, address, returnFindFocus, focusPage, returned, stop } = setup()
    try {
      returned('first', 'address')
      show('third')
      await nextTick()
      expect(address.cancelFocusReturn).toHaveBeenCalledOnce()
      show('first')
      await nextTick()
      await nextTick()
      expect(address.returnFocus).not.toHaveBeenCalled()
      expect(returnFindFocus).not.toHaveBeenCalled()
      expect(focusPage).not.toHaveBeenCalled()
    } finally { stop() }
  })

  it('gives up waiting when main\'s next state shows another tab, or the person presses a key or clicks first', async () => {
    const { show, address, returnFindFocus, focusPage, returned, stop } = setup()
    try {
      // Such as a held Ctrl+Tab going on to the next tab before the shell drew this one.
      returned('first', 'address')
      show('second')
      await nextTick()
      returned('first', 'find')
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }))
      returned('first', 'address')
      document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }))
      expect(address.cancelFocusReturn).toHaveBeenCalledTimes(3)
      show('first')
      await nextTick()
      await nextTick()
      expect(address.returnFocus).not.toHaveBeenCalled()
      expect(returnFindFocus).not.toHaveBeenCalled()
      expect(focusPage).not.toHaveBeenCalled()
    } finally { stop() }
  })

  // A pane beside the page took the keyboard as its first document loaded, and main gave it back to the shell: the
  // address field that had it took it back with its suggestions open, as if the person had just clicked into it.
  it('takes the keyboard main gives the shell back without opening the address suggestions', () => {
    const { address, givenBack, stop } = setup()
    const windowTakesKeyboard = () => window.dispatchEvent(new FocusEvent('focus'))
    vi.useFakeTimers()
    try {
      givenBack()
      expect(address.expectFocusReturn).toHaveBeenCalledOnce()
      // The window takes the keyboard, and the field in the same task, which is the one main gave it back to.
      windowTakesKeyboard()
      expect(address.cancelFocusReturn).not.toHaveBeenCalled()
      vi.runAllTimers()
      expect(address.cancelFocusReturn).toHaveBeenCalledOnce()
      // Only the window taking the keyboard main gave back.
      windowTakesKeyboard()
      vi.runAllTimers()
      expect(address.cancelFocusReturn).toHaveBeenCalledOnce()

      // The person going on before the window takes it ends the wait, which the window then does not end again.
      givenBack()
      document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }))
      expect(address.cancelFocusReturn).toHaveBeenCalledTimes(2)
      windowTakesKeyboard()
      vi.runAllTimers()
      expect(address.cancelFocusReturn).toHaveBeenCalledTimes(2)
    } finally {
      stop()
      vi.useRealTimers()
    }
  })

  it('leaves a field waiting for its tab expecting the keyboard when main gives the shell the keyboard back meanwhile', () => {
    const { address, givenBack, returned, stop } = setup()
    vi.useFakeTimers()
    try {
      returned('first', 'address')
      givenBack()
      window.dispatchEvent(new FocusEvent('focus'))
      vi.runAllTimers()
      expect(address.cancelFocusReturn).not.toHaveBeenCalled()
      // A key the person presses ends both.
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }))
      expect(address.cancelFocusReturn).toHaveBeenCalledOnce()
    } finally {
      stop()
      vi.useRealTimers()
    }
  })

  it('lets a key held since before the field takes the keyboard back repeat into it only as a shortcut', () => {
    const { returned, stop } = setup()
    const reached = vi.fn()
    document.addEventListener('keydown', reached)
    const press = (init: KeyboardEventInit) => {
      const event = new KeyboardEvent('keydown', { cancelable: true, bubbles: true, ...init })
      document.body.dispatchEvent(event)
      return event.defaultPrevented
    }
    try {
      expect(press({ key: 'Enter', repeat: true })).toBe(false)
      // Such as Enter on Switch to this tab, held: it would open the address shown again.
      returned('second', 'address')
      expect(press({ key: 'Enter', repeat: true })).toBe(true)
      expect(press({ key: 'Delete', repeat: true })).toBe(true)
      expect(reached).toHaveBeenCalledOnce()
      // A held Ctrl+Tab goes on through the tabs.
      expect(press({ key: 'Tab', ctrlKey: true, repeat: true })).toBe(false)
      // A key pressed after it repeats as usual.
      expect(press({ key: 'Enter' })).toBe(false)
      expect(press({ key: 'Enter', repeat: true })).toBe(false)
      returned('second', 'find')
      stop()
      expect(press({ key: 'Enter', repeat: true })).toBe(false)
    } finally {
      document.removeEventListener('keydown', reached)
      stop()
    }
  })

  it('stops listening and expecting when it stops, and does nothing in a panel window', async () => {
    const { address, stopListening, stopKeyboardListening, stop } = setup()
    stop()
    expect(stopListening).toHaveBeenCalledOnce()
    expect(stopKeyboardListening).toHaveBeenCalledOnce()
    expect(address.cancelFocusReturn).toHaveBeenCalledOnce()

    const scope = effectScope()
    const stopPanel = scope.run(() => useTabFieldFocusReturn({
      shell: undefined,
      browserState: () => ({ activeTabId: 'first' }),
      focusedField: () => 'address',
      address,
      returnFindFocus: vi.fn(),
      focusPage: vi.fn()
    }))!
    stopPanel()
    scope.stop()
  })
})
