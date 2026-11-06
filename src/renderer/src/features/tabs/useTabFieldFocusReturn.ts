import { nextTick, watch } from 'vue'
import type { ShellTabField } from '../../../../shared/tab-field.js'
import type { HronautShellApi } from '../../../../shared/types.js'

export interface TabFieldFocusReturnOptions {
  /** Main, which keeps the field of the tab left and says when the tab is shown again; none in a panel window. */
  shell: Pick<HronautShellApi, 'setTabFieldFocused' | 'onTabFieldFocusReturned' | 'onKeyboardGivenBack'> | undefined
  /** The browser state the shell shows, a new one for each that main sends. */
  browserState: () => { activeTabId: string | null }
  /** The shown tab's field that has the keyboard now. */
  focusedField: () => ShellTabField | null
  address: {
    /** The field is to take the keyboard back, which opens no suggestions until then. */
    expectFocusReturn: () => void
    cancelFocusReturn: () => void
    returnFocus: (tabId: string) => boolean
  }
  returnFindFocus: (tabId: string) => boolean
  focusPage: () => void
}

/**
 * Tells main which of the shown tab's fields has the keyboard, and gives it back when main shows the tab again, as
 * Chrome gives a tab its focused view back. The page takes the keyboard when the field cannot, such as when Find did
 * not come back with the tab.
 */
export function useTabFieldFocusReturn(options: TabFieldFocusReturnOptions): () => void {
  const shell = options.shell
  if (!shell) return () => undefined
  // A tab's row takes the keyboard on the press of the click that selects another tab, which Chrome's tabs do not, so
  // until that click is over main is told the field that had the keyboard, which the tab left then keeps.
  let fieldOfTabLeft: ShellTabField | null = null
  // Told at once, so that a tab selected in the turn the field gives up the keyboard, as Switch to this tab does, is
  // left without it.
  const stopTelling = watch(options.focusedField, (field) => {
    if (field === null && fieldOfTabLeft !== null) return
    fieldOfTabLeft = null
    shell.setTabFieldFocused(field)
  }, { immediate: true, flush: 'sync' })
  // Only the main button clicks a tab; another opens its menu, or closes it.
  const holdFieldForTabClick = (event: MouseEvent): void => {
    const field = options.focusedField()
    if (event.button !== 0 || field === null) return
    if (event.target instanceof Element && event.target.closest('[role="tab"][data-tab-id]')) fieldOfTabLeft = field
  }
  const releaseField = (): void => {
    if (fieldOfTabLeft === null) return
    fieldOfTabLeft = null
    shell.setTabFieldFocused(options.focusedField())
  }
  // The click comes after the press ends, in the same task, and selects its tab before a timer runs.
  let releaseTimer: ReturnType<typeof setTimeout> | undefined
  const releaseFieldAfterClick = (): void => {
    clearTimeout(releaseTimer)
    releaseTimer = setTimeout(releaseField, 0)
  }
  window.addEventListener('pointerdown', holdFieldForTabClick, true)
  window.addEventListener('pointerup', releaseFieldAfterClick, true)
  // A tab dragged away is not clicked, nor one whose menu opens, as with Ctrl and the click on macOS: the menu takes the
  // end of the press. Nor is one when the person leaves the window during the press.
  window.addEventListener('pointercancel', releaseField, true)
  window.addEventListener('contextmenu', releaseField, true)
  window.addEventListener('blur', releaseField)
  let pending: { tabId: string; field: ShellTabField } | undefined
  // Main gave the shell the keyboard back, which the window has not taken yet.
  let keyboardComingBack = false
  // As in a trusted dialog, a key held since before the field takes the keyboard back does not repeat into it, such as
  // Enter on Switch to this tab, which would open the address shown again, or Delete closing a tab, which would delete
  // its text. With Ctrl, Alt or Cmd the key is a shortcut and goes on repeating, such as Ctrl+Tab going through tabs.
  let holdingKeys = false
  const dropHeldRepeat = (event: KeyboardEvent): void => {
    if (!event.repeat) {
      holdingKeys = false
      // The person goes on, so a field still waiting for its tab does not take the keyboard later.
      giveUp()
    }
    if (!holdingKeys || event.ctrlKey || event.altKey || event.metaKey) return
    event.preventDefault()
    event.stopImmediatePropagation()
  }
  window.addEventListener('keydown', dropHeldRepeat, true)
  window.addEventListener('pointerdown', giveUp, true)

  function giveUp(): void {
    if (!pending && !keyboardComingBack) return
    pending = undefined
    keyboardComingBack = false
    options.address.cancelFocusReturn()
  }

  // Main gives the shell back the keyboard a page took, such as a pane beside the page that loads its first document,
  // and the field that had it takes it back as it had it, without opening its suggestions. The window takes the
  // keyboard in the same task as the field, so the field's next focus is the person's once that task is over.
  let keyboardBackTimer: ReturnType<typeof setTimeout> | undefined
  const keyboardBack = (): void => {
    if (!keyboardComingBack) return
    keyboardComingBack = false
    // A field still waiting for its tab goes on expecting the keyboard.
    if (!pending) options.address.cancelFocusReturn()
  }
  const windowTookKeyboard = (): void => {
    if (!keyboardComingBack) return
    clearTimeout(keyboardBackTimer)
    keyboardBackTimer = setTimeout(keyboardBack, 0)
  }
  window.addEventListener('focus', windowTookKeyboard)
  const stopKeyboardListening = shell.onKeyboardGivenBack(() => {
    keyboardComingBack = true
    options.address.expectFocusReturn()
  })

  async function give(request: { tabId: string; field: ShellTabField }): Promise<void> {
    // The tab's address and its Find come back with the tab first.
    await nextTick()
    if (pending !== request) return
    pending = undefined
    if (request.field === 'find') options.address.cancelFocusReturn()
    const given = request.field === 'address' ? options.address.returnFocus(request.tabId) : options.returnFindFocus(request.tabId)
    if (!given) options.focusPage()
  }

  // Main says so before it gives the shell the keyboard, and before the shell shows the tab.
  const stopListening = shell.onTabFieldFocusReturned((tabId, field) => {
    const request = { tabId, field }
    pending = request
    holdingKeys = true
    options.address.expectFocusReturn()
    if (options.browserState().activeTabId === tabId) void give(request)
  })
  // The next state main sends shows the tab, or another the person went on to, such as with a held Ctrl+Tab: then the
  // field gives up waiting, not to take the keyboard from a page later.
  const stopWatching = watch(options.browserState, (state) => {
    if (!pending) return
    if (state.activeTabId === pending.tabId) void give(pending)
    else giveUp()
  })

  return () => {
    stopTelling()
    clearTimeout(releaseTimer)
    window.removeEventListener('pointerdown', holdFieldForTabClick, true)
    window.removeEventListener('pointerup', releaseFieldAfterClick, true)
    window.removeEventListener('pointercancel', releaseField, true)
    window.removeEventListener('contextmenu', releaseField, true)
    window.removeEventListener('blur', releaseField)
    stopListening()
    stopWatching()
    window.removeEventListener('keydown', dropHeldRepeat, true)
    window.removeEventListener('pointerdown', giveUp, true)
    stopKeyboardListening()
    window.removeEventListener('focus', windowTookKeyboard)
    clearTimeout(keyboardBackTimer)
    pending = undefined
    keyboardComingBack = false
    options.address.cancelFocusReturn()
  }
}
