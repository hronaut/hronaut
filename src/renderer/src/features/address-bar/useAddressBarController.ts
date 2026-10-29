import { computed, nextTick, onBeforeUnmount, ref, shallowRef, watch, type ComputedRef, type Ref } from 'vue'
import { useResizeObserver } from '@vueuse/core'
import { addressPasteText } from '../../../../shared/address-paste.js'
import type { AddressSuggestion, AddressSuggestionOverlayRequest, AddressSuggestionOverlayTheme, AddressSuggestionSelection } from '../../../../shared/address-suggestions.js'
import {
  ADDRESS_SUGGESTION_TITLE_MAX_LENGTH,
  ADDRESS_SUGGESTION_URL_MAX_LENGTH,
  addressSuggestionScope,
  buildLocalAddressSuggestions,
  hasSwitchToTabButton,
  historySuggestionEntryId
} from '../../../../shared/address-suggestions.js'
import { isHronautHomeUrl } from '../../../../shared/home-url.js'
import type { SupportedLocale } from '../../../../shared/locale.js'
import type { SiteSearch } from '../../../../shared/site-search.js'
import type { BrowserBookmark, BrowserHistoryEntry, BrowserTabState } from '../../../../shared/types.js'
import { isImeCompositionEvent } from '../../keyboard-composition.js'
import { addressEnterAction, withWwwAndCom, type AddressEnterAction } from '../../address-enter.js'
import { inlineAddressCompletion, siteVisits, type AddressInlineCompletion } from '../../address-inline-completion.js'
import { keywordSearchTarget } from '../../address-keyword-search.js'
import { disposeAll, registerDisposers } from '../../composables/dispose-all.js'
import { useAddressKeywordMode } from './useAddressKeywordMode.js'

/**
 * The toolbar's address field fills the free space (styles/shell/toolbar.css). The take-over prompt takes room from it
 * only while it stays at least this wide, and its suggestions are never narrower than this.
 */
export const ADDRESS_FIELD_COMFORT_WIDTH = 520

interface AddressOverlayApi {
  show(request: AddressSuggestionOverlayRequest): void
  hide(): void
  returnFocus(): void
  onSelected(listener: (selection: AddressSuggestionSelection) => void): () => void
  onDismissed(listener: (sessionId: number) => void): () => void
}

interface AddressBarControllerOptions {
  activeTab: ComputedRef<BrowserTabState | undefined>
  /** The open tabs, in the tab strip's order, which Switch to this tab and @tabs find. */
  tabs: Readonly<Ref<readonly BrowserTabState[]>>
  bookmarks: Ref<BrowserBookmark[]>
  history: Ref<BrowserHistoryEntry[]>
  /** The site searches in Settings, whose shortcuts search their sites as the built-in engines' sites do. */
  siteSearches?: () => readonly SiteSearch[]
  overlay?: AddressOverlayApi
  theme: () => AddressSuggestionOverlayTheme
  locale: () => SupportedLocale
  translate: (key: string, parameters?: Record<string, string | number>, plural?: number) => string
  formatNumber: (value: number) => string
  onOpen: () => void
  onNavigate: (address: string) => Promise<void>
  /** Opens the address in a new tab; a background tab leaves the current one shown. */
  onOpenInNewTab: (address: string, background: boolean) => Promise<void>
  /** Shows another open tab, as Switch to this tab does in Chrome's address bar; false when it could not. */
  onSwitchToTab: (tabId: string) => Promise<boolean>
  /** Forgets a visit, as removing it in History does; history suggestions update when history does. */
  onRemoveVisit: (entryId: string) => Promise<unknown>
  onRemoveVisitFailed: (error: unknown) => void
  onFocusLeft: () => void
}

function displayedAddress(url: string | undefined): string {
  return url === 'about:blank' || url === 'hronaut://home/' ? '' : url ?? ''
}

let nextAddressOverlaySessionId = 0

export function useAddressBarController(options: AddressBarControllerOptions) {
  const address = ref('')
  const input = ref<HTMLInputElement | null>(null)
  const form = ref<HTMLFormElement | null>(null)
  const openState = ref(false)
  const open = computed({
    get: () => openState.value,
    set: (value: boolean) => {
      if (!value) discardPresentedSuggestions()
      openState.value = value
    }
  })
  const selection = ref(-1)
  const focused = ref(false)
  const editing = ref(false)
  const dirty = ref(false)
  // The visits Shift+Delete forgot. Their rows leave at once, as in Chrome, while history saves the change, and come
  // back if it fails; a visit never returns under the same id, since a new visit gets a new one.
  const forgottenVisits = shallowRef<ReadonlySet<string>>(new Set())
  // The rest of an address the field filled in after the text typed at its end, selected, as Chrome's address bar does;
  // see address-inline-completion.ts. It holds while the field has the keyboard and its text is still the typed text
  // and that rest.
  const inlineCompletion = shallowRef<(AddressInlineCompletion & { typed: string }) | null>(null)
  const completionShown = computed(() => inlineCompletion.value !== null && address.value === inlineCompletion.value.text)
  // What the suggestions match: the typed text, without the rest the field filled in.
  const query = computed(() => completionShown.value && inlineCompletion.value ? inlineCompletion.value.typed : address.value)
  // Tab to search an engine whose site the field shows, as in Chrome; see useAddressKeywordMode.ts. While the field
  // searches an engine it suggests nothing.
  const keywordMode = useAddressKeywordMode({
    address,
    input,
    typed: () => query.value,
    siteSearches: () => options.siteSearches?.() ?? [],
    offersKeyword: () => focused.value && dirty.value && !(visible.value && selected.value)
  })
  // The other open tabs with a page, kept as they were while their addresses stay the same, and their titles too while
  // @tabs lists them, so the browser state that each page's loading or new title brings does not draw the suggestions
  // again.
  let openTabsValue: { id: string; title: string; url: string }[] = []
  const listsOpenTabs = computed(() => addressSuggestionScope(query.value) === 'tabs')
  const openTabs = computed(() => {
    const shown = options.activeTab.value?.id
    const titled = listsOpenTabs.value
    const next = options.tabs.value
      .filter((tab) => tab.id !== shown && displayedAddress(tab.url) !== '' && !isHronautHomeUrl(tab.url))
      .map((tab) => ({ id: tab.id, title: titled ? tab.title : '', url: tab.url }))
    const unchanged = next.length === openTabsValue.length && next.every((tab, index) => {
      const previous = openTabsValue[index]
      return previous !== undefined && tab.id === previous.id && tab.url === previous.url && tab.title === previous.title
    })
    if (!unchanged) openTabsValue = next
    return openTabsValue
  })
  const history = computed(() => forgottenVisits.value.size
    ? options.history.value.filter((entry) => !forgottenVisits.value.has(entry.id))
    : options.history.value)
  // Read only while a completion is worked out.
  const visitsBySite = computed(() => siteVisits(history.value))
  const suggestions = computed(() => keywordMode.keyword.value ? [] : buildLocalAddressSuggestions({
    query: query.value,
    bookmarks: options.bookmarks.value,
    history: history.value,
    tabs: openTabs.value
  }))
  const visible = computed(() => open.value && suggestions.value.length > 0)
  const selected = computed(() => selection.value >= 0 ? suggestions.value[selection.value] : undefined)
  // Tab went on from the highlighted row to its Switch to this tab button, as in Chrome; moving the highlight goes back.
  const switchFocusedState = ref(false)
  const switchFocused = computed(() => switchFocusedState.value && visible.value && hasSwitchToTabButton(selected.value))
  let blurTimer: number | undefined
  let presentedSuggestions: AddressSuggestion[] = []
  let presentedSuggestionOwner: Pick<BrowserTabState, 'id'> | null = null
  let overlayPresented = false
  let overlaySessionId = 0
  let cleanupCallbacks: (() => void)[] = []
  // The highlighted row Shift+Delete forgot, whose highlight goes to the row that takes its place.
  let forgottenRow: string | null = null
  // Whether the Delete key held down forgot a visit, so that its repeats do nothing.
  let forgetKeyHeld = false
  // Whether the Tab key held down went on to Switch to this tab or back, so that its repeats leave the field alone.
  let switchKeyHeld = false
  // Whether the field is taking the rest of an address it fills in, which is not typing.
  let fillingCompletion = false
  // Whether the field is taking pasted text, which it leaves as pasted.
  let insertingPaste = false
  let pendingNavigation: {
    tabId: string | undefined
    initialUrl: string | undefined
    address: string
  } | null = null
  let disposed = false
  let draggingFromField = false

  function suggestionId(suggestion: AddressSuggestion): string {
    return `address-suggestion-${suggestion.id}`
  }

  /** The screen reader's option for a row's Switch to this tab button, which Tab goes on to. */
  function switchSuggestionId(suggestion: AddressSuggestion): string {
    return `${suggestionId(suggestion)}-switch`
  }

  function suggestionMeta(suggestion: AddressSuggestion): string {
    if (suggestion.kind === 'bookmark') return options.translate('runtime.suggestion.bookmark')
    if (suggestion.kind === 'tab') return options.translate('runtime.suggestion.openTab')
    return suggestion.visitCount && suggestion.visitCount > 1
      ? options.translate('runtime.suggestion.visits', { count: options.formatNumber(suggestion.visitCount) }, suggestion.visitCount)
      : options.translate('runtime.suggestion.history')
  }

  function cancelBlur(): void {
    if (blurTimer === undefined) return
    window.clearTimeout(blurTimer)
    blurTimer = undefined
  }

  function restoreActiveAddress(): void {
    const tab = options.activeTab.value
    address.value = pendingNavigation
      && pendingNavigation.tabId === tab?.id
      && pendingNavigation.initialUrl === tab?.url
      ? pendingNavigation.address
      : displayedAddress(tab?.url)
    inlineCompletion.value = null
    keywordMode.clear()
    dirty.value = false
  }

  function hideSuggestions(preservePresentedSuggestions = false): void {
    if (preservePresentedSuggestions) openState.value = false
    else open.value = false
    options.overlay?.hide()
  }

  function close(): void {
    hideSuggestions()
  }

  function discardPresentedSuggestions(): void {
    presentedSuggestions = []
    presentedSuggestionOwner = null
  }

  function openSuggestions(): void {
    if (disposed) return
    cancelBlur()
    selection.value = -1
    // Clear any pending native-overlay dismissal before reopening. A renderer
    // can focus the address bar again before the destroyed overlay's dismissal
    // event has completed its IPC round trip.
    if (!open.value) {
      overlaySessionId = ++nextAddressOverlaySessionId
      discardPresentedSuggestions()
      options.overlay?.hide()
    }
    open.value = true
    options.onOpen()
  }

  function handleFocus(): void {
    focused.value = true
    editing.value = true
    openSuggestions()
  }

  function handleInput(event?: Event): void {
    focused.value = true
    editing.value = true
    dirty.value = true
    if (fillingCompletion) return
    const completion = inlineCompletion.value
    // An input method composing over the rest leaves the field's text to it until it is done; the suggestions stay the
    // typed text's.
    if (completion && event instanceof InputEvent && event.isComposing && address.value === completion.text) address.value = completion.typed
    inlineCompletion.value = null
    openSuggestions()
    if (!keywordMode.enterFromSpace(event)) completeInline(event)
  }

  // Typing at the end of the field fills in the rest of a site or page it starts, selected, so that typing on replaces
  // it, Backspace or Delete takes it away, and Enter opens it, as in Chrome's address bar. Text pasted, dropped, typed
  // elsewhere in the field or still being composed is left as it is, as Chrome leaves it.
  function completeInline(event: Event | undefined): void {
    const field = input.value
    if (disposed || insertingPaste || !field || !(event instanceof InputEvent) || event.inputType !== 'insertText' || event.isComposing) return
    const typed = field.value
    if (field.selectionStart !== typed.length || field.selectionEnd !== typed.length) return
    const completion = inlineAddressCompletion(typed, suggestions.value, visitsBySite.value)
    if (!completion) return
    inlineCompletion.value = { ...completion, typed }
    const rest = completion.text.slice(typed.length)
    if (rest) {
      fillingCompletion = true
      try {
        // insertText puts the rest on the field's undo stack with the character typed, so Ctrl+Z steps back a
        // character at a time, as each looked.
        if (typeof document.execCommand !== 'function' || !document.execCommand('insertText', false, rest)) {
          field.setRangeText(rest, typed.length, typed.length, 'end')
        }
      } finally {
        fillingCompletion = false
      }
      address.value = field.value
    }
    field.setSelectionRange(typed.length, field.value.length)
  }

  // The rest the field filled in leaves, and the field shows the typed text, as when the highlight moves to a row.
  function dropInlineCompletion(): void {
    const completion = inlineCompletion.value
    if (!completion) return
    if (address.value === completion.text) address.value = completion.typed
    inlineCompletion.value = null
  }

  // What Enter opens: the site or page the field filled in, with its own scheme, or the text as it is.
  function enteredAddress(): string {
    return completionShown.value && inlineCompletion.value ? inlineCompletion.value.url : address.value
  }

  // A paste reads as Chrome's address bar reads one (see address-paste.ts): an address split over lines arrives whole,
  // and a leading javascript: is dropped, so text copied from a page never runs as script from the address bar.
  function handlePaste(event: ClipboardEvent): void {
    const pasted = event.clipboardData?.getData('text/plain') ?? ''
    const text = addressPasteText(pasted)
    const field = input.value
    if (disposed || text === pasted || !field) return
    event.preventDefault()
    if (!text) return
    // insertText keeps the paste on the field's undo stack and reports it as input, as a plain paste does.
    insertingPaste = true
    try {
      if (typeof document.execCommand === 'function' && document.execCommand('insertText', false, text)) return
    } finally {
      insertingPaste = false
    }
    field.setRangeText(text, field.selectionStart ?? field.value.length, field.selectionEnd ?? field.value.length, 'end')
    field.dispatchEvent(new Event('input', { bubbles: true }))
  }

  // Text dragged within the field is its own, so it moves as the field moves it.
  function handleDragStart(): void {
    draggingFromField = true
  }

  function handleDragEnd(): void {
    draggingFromField = false
  }

  // Text dropped from elsewhere is read as a paste. Text that needs nothing dropped lands where the field puts it; other
  // text replaces the field's text, as a drop does in Chrome's address bar, so a dropped javascript: never runs.
  function handleDrop(event: DragEvent): void {
    const dropped = event.dataTransfer?.getData('text/plain') ?? ''
    const text = addressPasteText(dropped)
    if (disposed || draggingFromField || text === dropped) return
    event.preventDefault()
    if (!text) return
    // The drop the field would have taken gives it the keyboard; this one does too, with the text selected, as Chrome's
    // does, so Enter opens it and leaving the field closes its suggestions.
    address.value = text
    const field = input.value
    if (field) {
      field.value = text
      field.focus()
      field.select()
    }
    handleInput()
  }

  function finishBlur(): void {
    blurTimer = undefined
    focused.value = false
    editing.value = false
    // A field left with a completion keeps its text as text, as Chrome's does.
    inlineCompletion.value = null
    if (!dirty.value) restoreActiveAddress()
  }

  function handleFocusOut(event: FocusEvent): void {
    const next = event.relatedTarget
    const staysInForm = next instanceof Node && (event.currentTarget as HTMLElement).contains(next)
    const leftInput = event.target === input.value && next !== input.value
    if (leftInput) {
      // Focus has left now, even if a tab change cancels the rest of the blur below.
      focused.value = false
      // The native suggestion view is outside this DOM and may deliver its
      // selection after the input loses focus. Other DOM controls invalidate it.
      hideSuggestions(next === null)
      cancelBlur()
      blurTimer = window.setTimeout(finishBlur, 0)
    }
    if (!staysInForm) {
      if (!leftInput) close()
      options.onFocusLeft()
    }
  }

  async function navigateTo(target: string): Promise<void> {
    const tab = options.activeTab.value
    const navigation = {
      tabId: tab?.id,
      initialUrl: tab?.url,
      address: target
    }
    pendingNavigation = navigation
    inlineCompletion.value = null
    keywordMode.clear()
    cancelBlur()
    editing.value = false
    dirty.value = false
    close()
    input.value?.blur()
    try {
      await options.onNavigate(target)
    } finally {
      if (pendingNavigation === navigation) {
        pendingNavigation = null
        if (!dirty.value) restoreActiveAddress()
      }
    }
  }

  async function openInNewTab(target: string, background: boolean): Promise<void> {
    if (!background) {
      // The new tab takes over, and this tab's field shows its own address again when the person comes back to it.
      cancelBlur()
      close()
      editing.value = false
      dirty.value = false
      restoreActiveAddress()
      input.value?.blur()
    }
    // A tab opened behind leaves the typed text and its suggestions open, as in Chrome, to open another or edit it.
    await options.onOpenInNewTab(target, background)
  }

  // Enter with Ctrl, Alt or (on a Mac) ⌘ does what it does in Chrome's address bar; see address-enter.ts.
  function handleModifiedEnter(event: KeyboardEvent, action: AddressEnterAction): boolean {
    const suggestion = visible.value ? selected.value : undefined
    // A picked suggestion is a whole address already, so Ctrl+Enter opens it as Enter does.
    if (action === 'add-www-and-com' && suggestion) return false
    event.preventDefault()
    // A held key opens the address once, not a tab for each repeat.
    if (disposed || event.repeat) return true
    const keyword = keywordMode.keyword.value
    if (keyword) {
      // A keyword search is a search whatever is typed, so Ctrl+Enter searches as Enter does.
      const target = keywordSearchTarget(keyword, address.value)
      if (action !== 'add-www-and-com') {
        void openInNewTab(target, action === 'new-background-tab')
        return true
      }
      address.value = target
      void navigateTo(target)
      return true
    }
    if (action === 'add-www-and-com') {
      // Ctrl+Enter adds www. and .com to what was typed, not to the rest the field filled in, as in Chrome.
      const typed = query.value
      if (typed.trim()) void navigateTo(withWwwAndCom(typed) ?? typed)
      return true
    }
    const target = suggestion?.url ?? enteredAddress().trim()
    if (target) void openInNewTab(target, action === 'new-background-tab')
    return true
  }

  async function submit(): Promise<void> {
    if (disposed) return
    const keyword = keywordMode.keyword.value
    if (keyword) {
      // The field shows where the search goes while it loads, as it shows a picked suggestion's address.
      address.value = keywordSearchTarget(keyword, address.value)
      await navigateTo(address.value)
      return
    }
    if (!address.value.trim()) return
    await navigateTo(enteredAddress())
  }

  // Paste and Go in the field's menu shows the clipboard text in the field and opens it as Enter would, as in Chrome.
  async function pasteAndGo(text: string): Promise<void> {
    if (disposed || !text.trim()) return
    address.value = text
    await navigateTo(text)
  }

  async function chooseSuggestion(suggestion: AddressSuggestion): Promise<void> {
    if (disposed) return
    address.value = suggestion.url
    await navigateTo(suggestion.url)
  }

  // Switch to this tab, or an open tab's row, shows that tab, and this tab's field shows its own address again for when
  // the person comes back, as a new tab in front leaves it. A tab closed meanwhile, or one that could not be shown,
  // opens its page here instead.
  async function switchToTab(suggestion: AddressSuggestion): Promise<void> {
    if (disposed) return
    const tabId = suggestion.openTabId
    if (!tabId || !options.tabs.value.some((tab) => tab.id === tabId)) {
      await chooseSuggestion(suggestion)
      return
    }
    cancelBlur()
    close()
    editing.value = false
    dirty.value = false
    restoreActiveAddress()
    input.value?.blur()
    if (!await options.onSwitchToTab(tabId) && !disposed) await chooseSuggestion(suggestion)
  }

  // Tab goes on from a highlighted bookmark or visit open in another tab to its Switch to this tab button, and Shift+Tab
  // comes back, as in Chrome's address bar; otherwise Tab leaves the field as usual. A held key moves once, and its
  // repeats keep the keyboard in the field.
  function moveToSwitchButton(event: KeyboardEvent): boolean {
    if (event.key !== 'Tab') return false
    if (!event.repeat) switchKeyHeld = false
    if (event.ctrlKey || event.altKey || event.metaKey) return false
    if (event.repeat && switchKeyHeld) {
      event.preventDefault()
      return true
    }
    if (!visible.value || !hasSwitchToTabButton(selected.value) || event.shiftKey !== switchFocused.value) return false
    event.preventDefault()
    switchKeyHeld = true
    switchFocusedState.value = !event.shiftKey
    return true
  }

  function revealSelected(): void {
    const suggestion = selected.value
    if (!suggestion) return
    document.getElementById(suggestionId(suggestion))?.scrollIntoView?.({ block: 'nearest' })
  }

  async function moveSelection(offset: -1 | 1): Promise<void> {
    const count = suggestions.value.length
    if (!count) return
    // Moving the highlight goes back from Switch to this tab, even to the same row when it is the only one.
    switchFocusedState.value = false
    dropInlineCompletion()
    if (!open.value) openSuggestions()
    if (selection.value < 0) selection.value = offset === 1 ? 0 : count - 1
    else selection.value = (selection.value + offset + count) % count
    open.value = true
    await nextTick()
    revealSelected()
  }

  // Shift+Delete forgets the highlighted visit, as in Chrome's address bar: its row leaves at once and the highlight goes
  // to the row in its place. A bookmark stays, and the key then edits the text as usual. A held key forgets one visit,
  // and its repeats leave the text alone, whatever is highlighted next.
  function forgetSelectedVisit(event: KeyboardEvent): boolean {
    if (event.key !== 'Delete') return false
    if (!event.repeat) forgetKeyHeld = false
    if (!event.shiftKey || event.ctrlKey || event.altKey || event.metaKey) return false
    if (event.repeat) {
      if (!forgetKeyHeld) return false
      event.preventDefault()
      return true
    }
    const highlighted = visible.value ? selected.value : undefined
    // With nothing highlighted, the key forgets the visit the field filled in from, as Chrome forgets its default row.
    const completion = completionShown.value ? inlineCompletion.value : null
    const suggestion = highlighted ?? (completion ? suggestions.value.find((candidate) => candidate.id === completion.suggestionId) : undefined)
    const entryId = suggestion && historySuggestionEntryId(suggestion)
    if (!suggestion || !entryId) {
      if (highlighted || !completion) return false
      // The rest filled in from a bookmark leaves instead of being cut.
      event.preventDefault()
      dropInlineCompletion()
      return true
    }
    event.preventDefault()
    if (disposed) return true
    forgetKeyHeld = true
    forgottenRow = suggestion.id
    forgottenVisits.value = new Set(forgottenVisits.value).add(entryId)
    void options.onRemoveVisit(entryId).catch((error: unknown) => {
      if (disposed) return
      const remaining = new Set(forgottenVisits.value)
      remaining.delete(entryId)
      forgottenVisits.value = remaining
      options.onRemoveVisitFailed(error)
    })
    return true
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (isImeCompositionEvent(event)) return
    if (event.key === 'Escape' && (open.value || dirty.value)) {
      event.preventDefault()
      close()
      discardPresentedSuggestions()
      restoreActiveAddress()
      input.value?.select()
      return
    }
    const enterAction = addressEnterAction(event, window.hronautShell?.windowChrome?.platform === 'darwin')
    if (enterAction && handleModifiedEnter(event, enterAction)) return
    if (forgetSelectedVisit(event)) return
    if (keywordMode.handleKeydown(event)) return
    if (!suggestions.value.length) return
    if (moveToSwitchButton(event)) return
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      void moveSelection(event.key === 'ArrowDown' ? 1 : -1)
      return
    }
    if (event.key === 'Enter' && visible.value && selected.value) {
      event.preventDefault()
      void (switchFocused.value || selected.value.kind === 'tab' ? switchToTab(selected.value) : chooseSuggestion(selected.value))
    }
  }

  function syncOverlay(): void {
    if (disposed) return
    const overlay = options.overlay
    if (!overlay) return
    if (!visible.value || !form.value) {
      // The rows change with each page that loads, and each hide is a message to main: hide only what was shown.
      if (overlayPresented) overlay.hide()
      overlayPresented = false
      return
    }
    const formBounds = form.value.getBoundingClientRect()
    const viewportMargin = 12
    const availableWidth = Math.max(1, window.innerWidth - viewportMargin * 2)
    // As wide as the address field, and never narrower than its comfortable width, so a field squeezed by a narrow
    // window still gets readable suggestions.
    const width = Math.min(availableWidth, Math.max(formBounds.width + 2, Math.min(ADDRESS_FIELD_COMFORT_WIDTH + 2, availableWidth)))
    const x = Math.max(viewportMargin, Math.min(formBounds.left - 1, window.innerWidth - width - viewportMargin))
    const y = Math.ceil(formBounds.bottom + 7)
    const maxHeight = Math.max(1, Math.min(440, window.innerHeight - y - viewportMargin))
    const activeTab = options.activeTab.value
    presentedSuggestions = suggestions.value.map((suggestion) => ({ ...suggestion }))
    presentedSuggestionOwner = activeTab ? { id: activeTab.id } : null
    overlay.show({
      sessionId: overlaySessionId,
      bounds: { x, y, width, maxHeight },
      suggestions: presentedSuggestions.map(forSuggestionsView),
      selectedIndex: selection.value,
      ...(switchFocused.value ? { selectedAction: 'switch-tab' as const } : {}),
      theme: options.theme(),
      locale: options.locale()
    })
    overlayPresented = true
  }

  function handleResize(): void {
    syncOverlay()
  }

  // The suggestions view shows at most so much of an address or title. An open tab's address can be longer, as a data:
  // page's or one kept in the fragment is; the field keeps the whole one to open.
  function forSuggestionsView(suggestion: AddressSuggestion): AddressSuggestion {
    if (suggestion.url.length <= ADDRESS_SUGGESTION_URL_MAX_LENGTH && suggestion.title.length <= ADDRESS_SUGGESTION_TITLE_MAX_LENGTH) {
      return suggestion
    }
    return {
      ...suggestion,
      url: suggestion.url.slice(0, ADDRESS_SUGGESTION_URL_MAX_LENGTH),
      title: suggestion.title.slice(0, ADDRESS_SUGGESTION_TITLE_MAX_LENGTH)
    }
  }

  const registrations: Array<() => () => void> = [
    // A compact rail can reflow the address row without resizing the window, and the
    // centered field moves without changing size when the toolbar or its commands do.
    () => useResizeObserver(() => {
      const field = form.value
      const toolbar = field?.closest<HTMLElement>('.toolbar')
      return [field, toolbar, toolbar?.querySelector<HTMLElement>('.toolbar-commands')]
        .filter((element): element is HTMLElement => Boolean(element))
    }, syncOverlay).stop,
    () => watch(suggestions, async (next, previous) => {
      if (disposed) return
      const selectedSuggestion = previous[selection.value]
      let index = selectedSuggestion
        ? next.findIndex((suggestion) => suggestion.id === selectedSuggestion.id && suggestion.url === selectedSuggestion.url)
        : -1
      // The forgotten visit's highlight goes to the row in its place, or the last row, as in Chrome.
      if (index < 0 && selectedSuggestion && selectedSuggestion.id === forgottenRow && next.length) {
        index = Math.min(selection.value, next.length - 1)
      }
      forgottenRow = null
      selection.value = index
      await nextTick()
      if (!disposed) revealSelected()
    }, { flush: 'sync' }),
    // New suggestions, as another tab's visits or clearing history bring, keep a completion they still give, and take
    // away one they no longer give, leaving the typed text.
    () => watch(suggestions, (next) => {
      const completion = inlineCompletion.value
      if (!completion || !completionShown.value) return
      const still = inlineAddressCompletion(completion.typed, next, visitsBySite.value)
      if (still?.text !== completion.text) dropInlineCompletion()
      else if (still.url !== completion.url || still.suggestionId !== completion.suggestionId) inlineCompletion.value = { ...still, typed: completion.typed }
    }, { flush: 'sync' }),
    // Moving the highlight to another row, by key or as the rows change, goes back from Switch to this tab to the row.
    () => watch(() => `${selection.value} ${selected.value?.id ?? ''} ${selected.value?.openTabId ?? ''}`, () => {
      switchFocusedState.value = false
    }, { flush: 'sync' }),
    () => watch(
      [visible, suggestions, selection, switchFocused, options.theme, options.locale],
      async () => {
        if (disposed) return
        await nextTick()
        syncOverlay()
      }
    ),
    () => watch(
      [() => options.activeTab.value?.id, () => options.activeTab.value?.url],
      ([tabId, url], [previousTabId]) => {
        if (disposed) return
        const tabChanged = previousTabId !== undefined && tabId !== previousTabId
        if (tabChanged || (
          pendingNavigation
          && pendingNavigation.tabId === tabId
          && pendingNavigation.initialUrl !== url
        )) pendingNavigation = null
        if (tabChanged || (!editing.value && !dirty.value)) {
          cancelBlur()
          close()
          if (tabChanged) editing.value = false
          address.value = displayedAddress(url)
          inlineCompletion.value = null
          keywordMode.clear()
          dirty.value = false
        }
      },
      { immediate: true }
    )
  ]
  const overlay = options.overlay
  if (overlay) {
    registrations.push(
      () => overlay.onSelected(({ sessionId, suggestionId, disposition, action }) => {
        if (disposed) return
        // A middle press gave the suggestions view the keyboard. The field takes it back, and shows its suggestions
        // again, whether or not the row still opens.
        if (disposition) overlay.returnFocus()
        if (sessionId !== overlaySessionId) return
        const activeTab = options.activeTab.value
        // A row picked for another tab does nothing. A pick for this tab opens even when the tab's own page has changed
        // its address since, as a page still loading or one that moves its address to the section in view does, just as
        // Enter on the row opens it. Such a click did nothing before.
        if (!activeTab || activeTab.id !== presentedSuggestionOwner?.id) return
        const suggestion = presentedSuggestions.find((candidate) => candidate.id === suggestionId)
        if (!suggestion) return
        if (!disposition) {
          void (action === 'switch-tab' || suggestion.kind === 'tab' ? switchToTab(suggestion) : chooseSuggestion(suggestion))
          return
        }
        // A middle-click opens the row in a new tab behind, as Alt+Shift+Enter on it does.
        void openInNewTab(suggestion.url, true)
      }),
      () => overlay.onDismissed((sessionId) => {
        if (disposed || sessionId !== overlaySessionId) return
        open.value = false
        discardPresentedSuggestions()
        overlay.hide()
      })
    )
  }
  cleanupCallbacks = registerDisposers(registrations, () => {
    disposed = true
    cancelBlur()
    open.value = false
    overlay?.hide()
  })

  function dispose(): void {
    if (disposed) return
    disposed = true
    cancelBlur()
    open.value = false
    discardPresentedSuggestions()
    pendingNavigation = null
    const callbacks = cleanupCallbacks
    cleanupCallbacks = []
    disposeAll([
      ...callbacks,
      () => overlay?.hide()
    ])
  }

  onBeforeUnmount(dispose)

  return {
    address,
    input,
    form,
    open,
    selection,
    suggestions,
    visible,
    selected,
    switchFocused,
    focused,
    dirty,
    keyword: keywordMode.keyword,
    keywordHint: keywordMode.hint,
    suggestionId,
    switchSuggestionId,
    suggestionMeta,
    close,
    handleFocus,
    handleInput,
    handlePaste,
    handleDragStart,
    handleDragEnd,
    handleDrop,
    handleFocusOut,
    handleKeydown,
    submit,
    pasteAndGo,
    handleResize,
    dispose
  }
}

export type AddressBarController = ReturnType<typeof useAddressBarController>
