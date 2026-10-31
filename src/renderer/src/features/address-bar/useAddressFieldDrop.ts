import type { Ref } from 'vue'
import { addressPasteText } from '../../../../shared/address-paste.js'

interface AddressFieldDropOptions {
  address: Ref<string>
  input: Readonly<Ref<HTMLInputElement | null>>
  disposed: () => boolean
  /** Takes the dropped text as typed text. */
  onInput: () => void
}

/**
 * Text dragged onto the address field. Text dragged within the field is its own, so it moves as the field moves it.
 * Text dropped from elsewhere is read as a paste (see address-paste.ts): text that needs nothing dropped lands where the
 * field puts it; other text replaces the field's text, as a drop does in Chrome's address bar, so a dropped javascript:
 * never runs.
 */
export function useAddressFieldDrop(options: AddressFieldDropOptions) {
  let draggingFromField = false

  function handleDragStart(): void {
    draggingFromField = true
  }

  function handleDragEnd(): void {
    draggingFromField = false
  }

  function handleDrop(event: DragEvent): void {
    const dropped = event.dataTransfer?.getData('text/plain') ?? ''
    const text = addressPasteText(dropped)
    if (options.disposed() || draggingFromField || text === dropped) return
    event.preventDefault()
    if (!text) return
    // The drop the field would have taken gives it the keyboard; this one does too, with the text selected, as Chrome's
    // does, so Enter opens it and leaving the field closes its suggestions.
    options.address.value = text
    const field = options.input.value
    if (field) {
      field.value = text
      field.focus()
      field.select()
    }
    options.onInput()
  }

  return { handleDragStart, handleDragEnd, handleDrop }
}
