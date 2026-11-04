import { nextTick, watch } from 'vue'
import type { ShellTabField } from '../../../../shared/tab-field.js'
import type { HronautShellApi } from '../../../../shared/types.js'

export interface TabFieldFocusReturnOptions {
  /** Main, which keeps the field of the tab left and says when the tab is shown again; none in a panel window. */
  shell: Pick<HronautShellApi, 'setTabFieldFocused' | 'onTabFieldFocusReturned'> | undefined
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
  // Told at once, so that a tab selected in the turn the field gives up the keyboard, as Switch to this tab does, is
  // left without it.
  const stopTelling = watch(options.focusedField, (field) => shell.setTabFieldFocused(field), { immediate: true, flush: 'sync' })
  let pending: { tabId: string; field: ShellTabField } | undefined
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
    if (!pending) return
    pending = undefined
    options.address.cancelFocusReturn()
  }

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
    stopListening()
    stopWatching()
    window.removeEventListener('keydown', dropHeldRepeat, true)
    window.removeEventListener('pointerdown', giveUp, true)
    pending = undefined
    options.address.cancelFocusReturn()
  }
}
