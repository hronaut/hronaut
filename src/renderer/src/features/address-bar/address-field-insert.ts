/** Whether the address field is taking pasted or dropped text, which it fills in nothing after. */
export interface PasteInsertion {
  inserting: boolean
}

/**
 * Inserts text at the field's selection as a paste does: insertText keeps it on the field's undo stack and reports it
 * as input, and the field's own completion leaves it alone while `insertion.inserting` is set.
 */
export function insertAsPaste(field: HTMLInputElement, text: string, insertion: PasteInsertion): void {
  insertion.inserting = true
  try {
    if (typeof document.execCommand === 'function' && document.execCommand('insertText', false, text)) return
  } finally {
    insertion.inserting = false
  }
  field.setRangeText(text, field.selectionStart ?? field.value.length, field.selectionEnd ?? field.value.length, 'end')
  field.dispatchEvent(new Event('input', { bubbles: true }))
}
