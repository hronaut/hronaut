import { effectScope, nextTick, ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { useTabFieldFocusReturn } from '../../src/renderer/src/features/tabs/useTabFieldFocusReturn.js'
import type { ShellTabField } from '../../src/shared/tab-field.js'

// Switching tabs gave the page the keyboard. As Chrome gives a tab its focused view back, the shell tells main which
// field of the shown tab has the keyboard, and gives it back when main shows the tab again.
describe('giving a tab\'s field the keyboard back', () => {
  function setup(options: { returnFocus?: boolean; returnFindFocus?: boolean } = {}) {
    const activeTabId = ref<string | null>('second')
    const focusedField = ref<ShellTabField | null>(null)
    let returned: ((tabId: string, field: ShellTabField) => void) | undefined
    const stopListening = vi.fn()
    const shell = {
      setTabFieldFocused: vi.fn(),
      onTabFieldFocusReturned: vi.fn((listener: (tabId: string, field: ShellTabField) => void) => {
        returned = listener
        return stopListening
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
      activeTabId: () => activeTabId.value,
      focusedField: () => focusedField.value,
      address,
      returnFindFocus,
      focusPage
    }))!
    return {
      activeTabId, focusedField, shell, address, returnFindFocus, focusPage, stopListening,
      returned: (tabId: string, field: ShellTabField) => returned!(tabId, field),
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

  it('gives the address field the keyboard back once the tab is shown, keeping its suggestions closed until then', async () => {
    const { activeTabId, address, focusPage, returned, stop } = setup()
    try {
      // Main says so before the shell shows the tab.
      returned('first', 'address')
      expect(address.expectFocusReturn).toHaveBeenCalledOnce()
      await nextTick()
      expect(address.returnFocus).not.toHaveBeenCalled()
      activeTabId.value = 'first'
      await nextTick()
      await nextTick()
      expect(address.returnFocus).toHaveBeenCalledExactlyOnceWith('first')
      expect(focusPage).not.toHaveBeenCalled()

      // Or once the tab is already shown.
      activeTabId.value = 'second'
      await nextTick()
      returned('second', 'address')
      await nextTick()
      expect(address.returnFocus).toHaveBeenLastCalledWith('second')
      expect(address.returnFocus).toHaveBeenCalledTimes(2)
    } finally { stop() }
  })

  it('gives Find\'s field the keyboard back, and the page when the field cannot take it', async () => {
    const { activeTabId, address, returnFindFocus, focusPage, returned, stop } = setup({ returnFindFocus: false })
    try {
      returned('first', 'find')
      activeTabId.value = 'first'
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
    const { activeTabId, focusPage, returned, stop } = setup({ returnFocus: false })
    try {
      activeTabId.value = 'first'
      await nextTick()
      returned('first', 'address')
      await nextTick()
      expect(focusPage).toHaveBeenCalledOnce()
    } finally { stop() }
  })

  it('gives nothing back when another tab is shown first', async () => {
    const { activeTabId, address, returnFindFocus, focusPage, returned, stop } = setup()
    try {
      returned('first', 'address')
      activeTabId.value = 'third'
      await nextTick()
      expect(address.cancelFocusReturn).toHaveBeenCalledOnce()
      activeTabId.value = 'first'
      await nextTick()
      await nextTick()
      expect(address.returnFocus).not.toHaveBeenCalled()
      expect(returnFindFocus).not.toHaveBeenCalled()
      expect(focusPage).not.toHaveBeenCalled()
    } finally { stop() }
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
    const { address, stopListening, stop } = setup()
    stop()
    expect(stopListening).toHaveBeenCalledOnce()
    expect(address.cancelFocusReturn).toHaveBeenCalledOnce()

    const scope = effectScope()
    const stopPanel = scope.run(() => useTabFieldFocusReturn({
      shell: undefined,
      activeTabId: () => 'first',
      focusedField: () => 'address',
      address,
      returnFindFocus: vi.fn(),
      focusPage: vi.fn()
    }))!
    stopPanel()
    scope.stop()
  })
})
