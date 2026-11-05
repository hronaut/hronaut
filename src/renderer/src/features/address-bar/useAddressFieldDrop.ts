import type { Ref } from 'vue'
import { addressPasteText } from '../../../../shared/address-paste.js'
import { TAB_DRAG_TYPE } from '../tabs/useTabDragReorder.js'

interface AddressFieldDropOptions {
  address: Ref<string>
  input: Readonly<Ref<HTMLInputElement | null>>
  disposed: () => boolean
  /** Takes the dropped text as typed text. */
  onInput: () => void
}

/**
 * Text or a link dragged onto the address field. Text dragged within the field is its own, so it moves as the field
 * moves it. Anything dropped from elsewhere replaces the field's text, as a drop does in Chrome's address bar, instead
 * of landing where the pointer is in the address shown: a link or image by its address, other text read as a paste
 * (see address-paste.ts), so a dropped javascript: never runs. A file from the computer and a tab of the rail drop
 * nothing.
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
    if (options.disposed() || draggingFromField) return
    event.preventDefault()
    const text = addressPasteText(droppedText(event.dataTransfer))
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

/** As Chrome's address bar reads a drop: the first address of a dragged link or image, else the dragged text. */
function droppedText(data: DataTransfer | null | undefined): string {
  if (!data) return ''
  const types = Array.from(data.types ?? [])
  if (types.includes(TAB_DRAG_TYPE)) return ''
  const address = data.getData('text/uri-list').split(/\r?\n/u).map((line) => line.trim()).find((line) => line && !line.startsWith('#'))
  if (address !== undefined) return /^file:/iu.test(address) ? '' : address
  return types.includes('Files') ? '' : data.getData('text/plain')
}
