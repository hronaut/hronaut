import type { AddressSuggestion } from '../../../../shared/address-suggestions.js'
import type { AddressInlineCompletion } from '../../address-inline-completion.js'

/** The rest of an address the field filled in after the text typed at its end, with that text. */
export type ShownInlineCompletion = AddressInlineCompletion & { typed: string }

/**
 * The completion with its rest taken as typed, as Chrome's address bar takes it once the caret or the selection moves,
 * with End, Home, Left, Right or a click. Null while the selection is still the rest, or the whole text, as when
 * Ctrl/Cmd+L selects it to start over, and for a completion with no rest.
 */
export function acceptedInlineCompletion(
  completion: ShownInlineCompletion,
  field: Pick<HTMLInputElement, 'selectionStart' | 'selectionEnd'>
): ShownInlineCompletion | null {
  if (completion.typed === completion.text) return null
  if (field.selectionEnd === completion.text.length && (field.selectionStart === completion.typed.length || field.selectionStart === 0)) return null
  return { ...completion, typed: completion.text }
}

/**
 * Whether a rest taken as typed still has the suggestion it came from. It then keeps that address for Enter, where
 * matching the whole text again would take the first suggestion for the site, whichever its scheme or page.
 */
export function keepsTakenCompletion(completion: ShownInlineCompletion, suggestions: readonly AddressSuggestion[]): boolean {
  return completion.typed === completion.text && suggestions.some((suggestion) => suggestion.id === completion.suggestionId)
}
