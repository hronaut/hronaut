import type { Ref } from 'vue'

/** The address field's text and selection when the person left a tab. */
interface LeftSelection {
  text: string
  start: number | null
  end: number | null
  direction: 'forward' | 'backward' | 'none' | null
}

interface AddressFocusReturnOptions {
  input: Readonly<Ref<HTMLInputElement | null>>
  activeTabId: () => string | undefined
  tabs: () => readonly { id: string }[]
  disposed: () => boolean
}

/**
 * The address field taking the keyboard back on coming back to a tab it had it in, as Chrome gives a tab its focused
 * view back: with the selection it had then, or all its text when the text changed since, and without opening the
 * suggestions, which Chrome's address bar shows again only once the person types.
 */
export function useAddressFocusReturn(options: AddressFocusReturnOptions) {
  const selections = new Map<string, LeftSelection>()
  let returning = false

  /** Keeps the field's selection for the tab left, while the field still shows that tab's text. */
  function keepSelection(tabId: string): void {
    const open = new Set(options.tabs().map((tab) => tab.id))
    for (const id of selections.keys()) {
      if (!open.has(id)) selections.delete(id)
    }
    const field = options.input.value
    if (field) selections.set(tabId, { text: field.value, start: field.selectionStart, end: field.selectionEnd, direction: field.selectionDirection })
  }

  /** The field is to take the keyboard back; until then, taking it opens no suggestions. */
  function expect(): void {
    returning = true
  }

  function cancel(): void {
    returning = false
  }

  /** Gives the field the keyboard back for the tab shown, then marks it focused; false when the tab shows no field. */
  function give(tabId: string, focused: () => void): boolean {
    returning = false
    const field = options.input.value
    const left = selections.get(tabId)
    selections.delete(tabId)
    if (options.disposed() || !field || options.activeTabId() !== tabId) return false
    returning = true
    try {
      field.focus({ preventScroll: true })
    } finally {
      returning = false
    }
    // A field the shell hides cannot take it.
    if (document.activeElement !== field) return false
    focused()
    if (left && left.text === field.value && left.start !== null && left.end !== null) {
      field.setSelectionRange(left.start, left.end, left.direction ?? undefined)
    } else field.select()
    return true
  }

  return { keepSelection, expect, cancel, give, returning: () => returning }
}
