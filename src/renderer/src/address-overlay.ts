import './address-overlay.css'
import { hasSwitchToTabButton, type AddressSuggestion, type AddressSuggestionOverlayState, type AddressSuggestionSelection } from '../../shared/address-suggestions.js'
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
  if (suggestion.kind === 'tab') return translate(locale, 'addressOverlay.openTab')
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
  state: Pick<AddressSuggestionOverlayState, 'selectedIndex' | 'selectedAction'>,
  locale: SupportedLocale
): HTMLButtonElement {
  const { selectedIndex } = state
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
  icon.textContent = suggestion.kind === 'bookmark' ? '★' : suggestion.kind === 'tab' ? '⇥' : '↶'

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
  // A bookmark or visit open in another tab offers Switch to this tab, as Chrome's address bar does. The keyboard stays
  // in the address field, which goes on to it with Tab, so it is drawn as a button without being one.
  let switchButton: HTMLElement | undefined
  if (hasSwitchToTabButton(suggestion)) {
    switchButton = document.createElement('span')
    switchButton.className = 'address-suggestion-switch'
    switchButton.textContent = translate(locale, 'addressOverlay.switchToTab')
    if (index === selectedIndex && state.selectedAction === 'switch-tab') switchButton.classList.add('focused')
    button.classList.add('has-switch')
    button.append(switchButton)
  }
  const onSwitch = (event: Event) => switchButton !== undefined && event.target instanceof Node && switchButton.contains(event.target)
  button.addEventListener('pointerdown', (event) => {
    event.preventDefault()
    // The primary button chooses a row, or switches to its tab on Switch to this tab, and a middle-click opens it in a
    // new tab behind, as in Chrome, whatever keys are held; a right click chooses nothing.
    if (event.button === 0) selectSuggestion({ sessionId, suggestionId: suggestion.id, ...(onSwitch(event) ? { action: 'switch-tab' as const } : {}) })
    else if (event.button === 1) selectSuggestion({ sessionId, suggestionId: suggestion.id, disposition: 'new-background-tab' })
  })
  button.addEventListener('click', (event) => {
    event.preventDefault()
    selectSuggestion({ sessionId, suggestionId: suggestion.id, ...(onSwitch(event) ? { action: 'switch-tab' as const } : {}) })
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
    list.append(suggestionButton(suggestion, state.sessionId, index, state, state.locale))
  })

  const footer = document.createElement('footer')
  const local = document.createElement('span')
  local.textContent = translate(state.locale, 'addressOverlay.localOnly')
  const scopes = document.createElement('span')
  for (const scope of ['@bookmarks', '@history', '@tabs']) {
    const key = document.createElement('kbd')
    key.textContent = scope
    scopes.append(key)
  }
  footer.append(local, scopes)
  panel.append(list, footer)
  root.replaceChildren(panel)

  // Suggestions opened again stay hidden until this measurement arrives, and
  // shown ones take its height. Waiting for an animation frame can leave both
  // sides waiting for the view to be shown.
  // Reading scrollHeight performs layout even when frames are suspended.
  const selected = panel.querySelector<HTMLElement>('.address-suggestion.selected')
  selected?.scrollIntoView({ block: 'nearest' })
  window.hronautAddressOverlayView.measured(Math.ceil(panel.scrollHeight + 2))
}

window.hronautAddressOverlayView.onState(render)
