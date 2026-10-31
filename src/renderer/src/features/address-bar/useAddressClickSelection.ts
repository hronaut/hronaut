import { useEventListener } from '@vueuse/core'
import type { Ref } from 'vue'

/** How far, in CSS pixels, the pointer may move between press and release for the press to stay a click. */
const DRAG_THRESHOLD = 4

/**
 * As in Chrome's address bar, a click that gives the field the keyboard selects all of its text, so what is typed next
 * replaces the address and a copy takes all of it. A drag keeps what it selected, and a click in the field that already
 * has the keyboard places the caret, as in any text field. A right click selects it too, before the field's menu reads
 * the selection, so Copy and Paste in that menu take the whole address.
 */
export function useAddressClickSelection(input: Readonly<Ref<HTMLInputElement | null>>): void {
  // Where the press that will select the field went down, until its release.
  let press: { x: number, y: number } | undefined
  // When the field last took the keyboard. A press reports when it happened, before the window gave the keyboard to the
  // field for it, so the field took it for this press when that came at the press or after it. That is what happens
  // when the page in the tab had the keyboard: the field stays the shell's focused element meanwhile.
  let focusedAt = Number.NEGATIVE_INFINITY

  useEventListener(input, 'focus', (event: FocusEvent) => {
    focusedAt = event.timeStamp
  })
  useEventListener(input, 'mousedown', (event: MouseEvent) => {
    const hadKeyboard = document.hasFocus() && document.activeElement === input.value && focusedAt < event.timeStamp
    press = (event.button === 0 || event.button === 2) && !hadKeyboard ? { x: event.clientX, y: event.clientY } : undefined
  })
  // A key pressed meanwhile, such as the menu key, is no part of the click.
  useEventListener(input, 'keydown', () => {
    press = undefined
  })
  useEventListener(input, 'mouseup', (event: MouseEvent) => {
    const pressed = press
    press = undefined
    if (!pressed || Math.hypot(event.clientX - pressed.x, event.clientY - pressed.y) > DRAG_THRESHOLD) return
    if (!selectAll()) return
    // Chromium would then put the caret where a press inside the field's earlier selection landed.
    event.preventDefault()
  })
  // The field's menu, which on Linux and macOS opens before the right button is released; macOS has already selected
  // the word under the pointer by then.
  useEventListener(input, 'contextmenu', () => {
    if (!press) return
    press = undefined
    selectAll()
  })

  // Backward, as Chrome selects it, so the field keeps showing the address from its start.
  function selectAll(): boolean {
    const field = input.value
    if (!field || document.activeElement !== field) return false
    field.setSelectionRange(0, field.value.length, 'backward')
    return true
  }
}
