import './address-overlay.css'
import type { AddressSuggestion, AddressSuggestionOverlayState, AddressSuggestionSelection } from '../../shared/address-suggestions.js'
import { translate } from '../../shared/i18n.js'
import type { SupportedLocale } from '../../shared/locale.js'

interface HronautAddressOverlayViewApi {
  onState(listener: (state: AddressSuggestionOverlayState) => void): () => void
  select(selection: AddressSuggestionSelection): void
  measured(height: number): void
}

declare global {
  interface Window {
    hronautAddressOverlayView: HronautAddressOverlayViewApi
  }
}

function requiredRoot(): HTMLElement {
  const element = document.querySelector<HTMLElement>('#address-overlay-root')
  if (!element) throw new Error('Address overlay root is unavailable')
  return element
}

const root = requiredRoot()

let selectedSuggestionId: string | null = null

function suggestionMeta(suggestion: AddressSuggestion, locale: SupportedLocale): string {
  if (suggestion.kind === 'bookmark') return translate(locale, 'addressOverlay.bookmark')
  return suggestion.visitCount && suggestion.visitCount > 1
    ? translate(locale, 'addressOverlay.historyVisits', { count: suggestion.visitCount })
    : translate(locale, 'addressOverlay.history')
}

function selectSuggestion(selection: AddressSuggestionSelection): void {
  const selectionKey = `${selection.sessionId}:${selection.suggestionId}`
  if (selectedSuggestionId === selectionKey) return
  selectedSuggestionId = selectionKey
  window.hronautAddressOverlayView.select(selection)
  window.setTimeout(() => {
    if (selectedSuggestionId === selectionKey) selectedSuggestionId = null
  }, 0)
}

function suggestionButton(
  suggestion: AddressSuggestion,
  sessionId: number,
  index: number,
  selectedIndex: number,
  locale: SupportedLocale
): HTMLButtonElement {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'address-suggestion'
  button.dataset.suggestionId = suggestion.id
  button.setAttribute('role', 'option')
  button.setAttribute('aria-selected', String(index === selectedIndex))
  if (index === selectedIndex) button.classList.add('selected')

  const icon = document.createElement('span')
  icon.className = `address-suggestion-icon kind-${suggestion.kind}`
  icon.setAttribute('aria-hidden', 'true')
  icon.textContent = suggestion.kind === 'bookmark' ? '★' : '↶'

  const copy = document.createElement('span')
  copy.className = 'address-suggestion-copy'
  const title = document.createElement('strong')
  title.textContent = suggestion.title
  const address = document.createElement('span')
  address.textContent = suggestion.url
  copy.append(title, address)

  const meta = document.createElement('small')
  meta.textContent = suggestionMeta(suggestion, locale)
  button.append(icon, copy, meta)
  button.addEventListener('pointerdown', (event) => {
    event.preventDefault()
    selectSuggestion({ sessionId, suggestionId: suggestion.id })
  })
  button.addEventListener('click', (event) => {
    event.preventDefault()
    selectSuggestion({ sessionId, suggestionId: suggestion.id })
  })
  return button
}

function render(state: AddressSuggestionOverlayState): void {
  document.documentElement.dataset.theme = state.theme
  document.documentElement.lang = state.locale
  document.documentElement.dir = 'ltr'
  selectedSuggestionId = null
  const panel = document.createElement('section')
  panel.className = 'address-suggestions'
  panel.setAttribute('role', 'listbox')
  panel.setAttribute('aria-label', translate(state.locale, 'addressOverlay.label'))

  const list = document.createElement('div')
  list.className = 'address-suggestion-list'
  state.suggestions.forEach((suggestion, index) => {
    list.append(suggestionButton(suggestion, state.sessionId, index, state.selectedIndex, state.locale))
  })

  const footer = document.createElement('footer')
  const local = document.createElement('span')
  local.textContent = translate(state.locale, 'addressOverlay.localOnly')
  const scopes = document.createElement('span')
  for (const scope of ['@bookmarks', '@history']) {
    const key = document.createElement('kbd')
    key.textContent = scope
    scopes.append(key)
  }
  footer.append(local, scopes)
  panel.append(list, footer)
  root.replaceChildren(panel)

  // The native view stays hidden until this measurement arrives. Waiting for
  // an animation frame can leave both sides waiting for the view to be shown.
  // Reading scrollHeight performs layout even when frames are suspended.
  const selected = panel.querySelector<HTMLElement>('.address-suggestion.selected')
  selected?.scrollIntoView({ block: 'nearest' })
  window.hronautAddressOverlayView.measured(Math.ceil(panel.scrollHeight + 2))
}

window.hronautAddressOverlayView.onState(render)
