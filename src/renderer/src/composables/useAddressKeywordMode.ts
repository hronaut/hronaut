import { computed, shallowRef, type Ref } from 'vue'
import { addressKeyword, siteSearchKeyword, type AddressKeyword } from '../address-keyword-search.js'
import type { SiteSearch } from '../../../shared/site-search.js'

interface AddressKeywordModeOptions {
  address: Ref<string>
  input: Ref<HTMLInputElement | null>
  /** What was typed, without the rest of an address the field filled in after it. */
  typed: () => string
  /** The site searches in Settings, whose shortcuts name engines too. */
  siteSearches: () => readonly SiteSearch[]
  /** Whether the person is typing in the field with no suggestion highlighted, when Tab can take a keyword. */
  offersKeyword: () => boolean
}

/**
 * Keyword search in the address field, as in Chrome's address bar (see address-keyword-search.ts). The field offers
 * Tab to search an engine whose site it shows. Tab, or a space typed after the site, takes the site away and leaves a
 * chip naming the engine, so that what is typed next searches it. Backspace at the start of the text gives the site
 * back, with what was typed after it.
 */
export function useAddressKeywordMode(options: AddressKeywordModeOptions) {
  const keyword = shallowRef<AddressKeyword | null>(null)
  // The field's text is the whole of it, with the rest of an address it filled in after what was typed. A site search's
  // shortcut typed whole is offered too while the field fills in more after it, as Chrome offers a typed keyword; an
  // engine's site is offered only as the field shows it, as before there were site searches.
  const hint = computed(() => {
    if (keyword.value || !options.offersKeyword()) return null
    const siteSearches = options.siteSearches()
    return addressKeyword(options.address.value, siteSearches) ?? siteSearchKeyword(options.typed(), siteSearches) ?? null
  })
  // Whether the Tab key held down took the keyword, so that its repeats keep the keyboard in the field.
  let tabHeld = false

  // Sets the field's text and caret at once, so that the caret is where it belongs before the next key.
  function setText(text: string, caret: number): void {
    options.address.value = text
    const field = options.input.value
    if (!field) return
    field.value = text
    field.setSelectionRange(caret, caret)
  }

  function enter(next: AddressKeyword, query: string): void {
    keyword.value = next
    setText(query, 0)
  }

  function leave(): void {
    const left = keyword.value
    if (!left) return
    keyword.value = null
    const query = options.address.value
    setText(query ? `${left.keyword} ${query}` : left.keyword, left.keyword.length)
  }

  function clear(): void {
    keyword.value = null
  }

  // Tab takes the keyword the field offers, and Shift+Tab gives the site back, as it steps back from a keyword in
  // Chrome; a held key does it once. Backspace with the caret at the start of the search gives the site back too.
  function handleKeydown(event: KeyboardEvent): boolean {
    if (event.key === 'Tab') {
      if (!event.repeat) tabHeld = false
      if (event.ctrlKey || event.altKey || event.metaKey) return false
      if (event.repeat && tabHeld) {
        event.preventDefault()
        return true
      }
      const offered = event.shiftKey ? null : hint.value
      if (!offered && !(event.shiftKey && keyword.value)) return false
      event.preventDefault()
      tabHeld = true
      if (offered) enter(offered, '')
      else leave()
      return true
    }
    if (event.key !== 'Backspace' || !keyword.value) return false
    const field = options.input.value
    if (!field || field.selectionStart !== 0 || field.selectionEnd !== 0) return false
    event.preventDefault()
    leave()
    return true
  }

  // A space typed right after an engine's site takes it as the keyword, and the text after the space is the search, as
  // in Chrome, without the spaces it starts with; the wide space a Japanese keyboard types does too, as Chrome takes it.
  // A space pasted or composed stays text.
  function enterFromSpace(event: Event | undefined): boolean {
    const field = options.input.value
    if (keyword.value || !field || !(event instanceof InputEvent) || event.inputType !== 'insertText' || event.isComposing) return false
    if (event.data !== ' ' && event.data !== '\u3000') return false
    const caret = field.selectionStart ?? 0
    if (caret < 1 || caret !== field.selectionEnd) return false
    const named = addressKeyword(field.value.slice(0, caret - 1), options.siteSearches())
    if (!named) return false
    enter(named, field.value.slice(caret).trimStart())
    return true
  }

  return { keyword, hint, clear, handleKeydown, enterFromSpace }
}
