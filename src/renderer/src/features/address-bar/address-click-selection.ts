import { useEventListener } from '@vueuse/core'
import type { Ref } from 'vue'

/**
 * As in Chrome's address bar, a click that gives the field the keyboard selects all of its text, so what is typed next
 * replaces the address and a copy takes all of it. A drag that selects part of the text keeps that part, and a click in
 * the field that already has the keyboard places the caret, as in any text field. A right click selects it too, before
 * the field's menu reads the selection, so Paste in that menu replaces the address.
 */
export function useAddressClickSelection(input: Readonly<Ref<HTMLInputElement | null>>): void {
  let selectOnRelease = false
  // The page took the keyboard from the field, so the window no longer has it here. The field stays the window's
  // focused element and has it again as soon as the window does, which a click on it may do before the click arrives.
  let leftWithWindow = false

  useEventListener(input, 'blur', () => {
    if (!document.hasFocus()) leftWithWindow = true
  })
  useEventListener(input, 'keydown', () => {
    leftWithWindow = false
  })
  useEventListener(input, 'mousedown', (event: MouseEvent) => {
    const hadKeyboard = document.activeElement === input.value && !leftWithWindow
    selectOnRelease = (event.button === 0 || event.button === 2) && !hadKeyboard
    leftWithWindow = false
  })
  // The button's release, or the field's menu, which on Linux opens before the right button is released.
  const selectAll = (): void => {
    if (!selectOnRelease) return
    selectOnRelease = false
    const field = input.value
    if (!field || document.activeElement !== field || field.selectionStart !== field.selectionEnd) return
    // Backward, as Chrome selects it, so the field keeps showing the address from its start.
    field.setSelectionRange(0, field.value.length, 'backward')
  }
  useEventListener(input, 'mouseup', selectAll)
  useEventListener(input, 'contextmenu', selectAll)
}
