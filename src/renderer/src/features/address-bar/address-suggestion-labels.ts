import type { AddressSuggestion } from '../../../../shared/address-suggestions.js'

type Translate = (key: string, parameters?: Record<string, string | number>, plural?: number) => string

/** The id of a suggestion's row in the field's list for screen readers. */
export function addressSuggestionId(suggestion: AddressSuggestion): string {
  return `address-suggestion-${suggestion.id}`
}

/** The screen reader's option for a row's Switch to this tab button, which Tab goes on to. */
export function addressSwitchSuggestionId(suggestion: AddressSuggestion): string {
  return `${addressSuggestionId(suggestion)}-switch`
}

/** What a row says it is after its title and address: a bookmark, an open tab, or a visit and how often. */
export function addressSuggestionMeta(suggestion: AddressSuggestion, translate: Translate, formatNumber: (value: number) => string): string {
  if (suggestion.kind === 'bookmark') return translate('runtime.suggestion.bookmark')
  if (suggestion.kind === 'tab') return translate('runtime.suggestion.openTab')
  return suggestion.visitCount && suggestion.visitCount > 1
    ? translate('runtime.suggestion.visits', { count: formatNumber(suggestion.visitCount) }, suggestion.visitCount)
    : translate('runtime.suggestion.history')
}
