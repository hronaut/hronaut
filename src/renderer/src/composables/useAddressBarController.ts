import { computed, nextTick, onBeforeUnmount, ref, shallowRef, watch, type ComputedRef, type Ref } from 'vue'
import { useResizeObserver } from '@vueuse/core'
import { addressPasteText } from '../../../shared/address-paste.js'
import type { AddressSuggestion, AddressSuggestionOverlayRequest, AddressSuggestionOverlayTheme, AddressSuggestionSelection } from '../../../shared/address-suggestions.js'
import { buildLocalAddressSuggestions, historySuggestionEntryId } from '../../../shared/address-suggestions.js'
import type { SupportedLocale } from '../../../shared/locale.js'
import type { BrowserBookmark, BrowserHistoryEntry, BrowserTabState } from '../../../shared/types.js'
import { isImeCompositionEvent } from '../keyboard-composition.js'
import { addressEnterAction, withWwwAndCom, type AddressEnterAction } from '../address-enter.js'
import { disposeAll, registerDisposers } from './dispose-all.js'

/**
 * The toolbar's address field fills the free space (styles/shell/toolbar.css). The take-over prompt takes room from it
 * only while it stays at least this wide, and its suggestions are never narrower than this.
 */
export const ADDRESS_FIELD_COMFORT_WIDTH = 520

interface AddressOverlayApi {
  show(request: AddressSuggestionOverlayRequest): void
  hide(): void
  onSelected(listener: (selection: AddressSuggestionSelection) => void): () => void
  onDismissed(listener: (sessionId: number) => void): () => void
}

interface AddressBarControllerOptions {
  activeTab: ComputedRef<BrowserTabState | undefined>
  bookmarks: Ref<BrowserBookmark[]>
  history: Ref<BrowserHistoryEntry[]>
  overlay?: AddressOverlayApi
  theme: () => AddressSuggestionOverlayTheme
  locale: () => SupportedLocale
  translate: (key: string, parameters?: Record<string, string | number>, plural?: number) => string
  formatNumber: (value: number) => string
  onOpen: () => void
  onNavigate: (address: string) => Promise<void>
  /** Opens the address in a new tab; a background tab leaves the current one shown. */
  onOpenInNewTab: (address: string, background: boolean) => Promise<void>
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
  const suggestions = computed(() => buildLocalAddressSuggestions({
    query: address.value,
    bookmarks: options.bookmarks.value,
    history: forgottenVisits.value.size
      ? options.history.value.filter((entry) => !forgottenVisits.value.has(entry.id))
      : options.history.value
  }))
  const visible = computed(() => open.value && suggestions.value.length > 0)
  const selected = computed(() => selection.value >= 0 ? suggestions.value[selection.value] : undefined)
  let blurTimer: number | undefined
  let presentedSuggestions: AddressSuggestion[] = []
  let presentedSuggestionOwner: Pick<BrowserTabState, 'id'> | null = null
  let overlaySessionId = 0
  let cleanupCallbacks: (() => void)[] = []
  // The highlighted row Shift+Delete forgot, whose highlight goes to the row that takes its place.
  let forgottenRow: string | null = null
  // Whether the Delete key held down forgot a visit, so that its repeats do nothing.
  let forgetKeyHeld = false
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

  function suggestionMeta(suggestion: AddressSuggestion): string {
    if (suggestion.kind === 'bookmark') return options.translate('runtime.suggestion.bookmark')
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

  function handleInput(): void {
    focused.value = true
    editing.value = true
    dirty.value = true
    openSuggestions()
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
    if (typeof document.execCommand === 'function' && document.execCommand('insertText', false, text)) return
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
    address.value = text
    handleInput()
  }

  function finishBlur(): void {
    blurTimer = undefined
    focused.value = false
    editing.value = false
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
    cancelBlur()
    close()
    if (!background) {
      // The new tab takes over, and this tab's field shows its own address again when the person comes back to it.
      editing.value = false
      dirty.value = false
      restoreActiveAddress()
      input.value?.blur()
    }
    // A background tab keeps the typed text in the field, as in Chrome, to edit and open again.
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
    if (action === 'add-www-and-com') {
      if (address.value.trim()) void navigateTo(withWwwAndCom(address.value) ?? address.value)
      return true
    }
    const target = suggestion?.url ?? address.value.trim()
    if (target) void openInNewTab(target, action === 'new-background-tab')
    return true
  }

  async function submit(): Promise<void> {
    if (disposed || !address.value.trim()) return
    await navigateTo(address.value)
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

  function revealSelected(): void {
    const suggestion = selected.value
    if (!suggestion) return
    document.getElementById(suggestionId(suggestion))?.scrollIntoView?.({ block: 'nearest' })
  }

  async function moveSelection(offset: -1 | 1): Promise<void> {
    const count = suggestions.value.length
    if (!count) return
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
    const suggestion = visible.value ? selected.value : undefined
    const entryId = suggestion && historySuggestionEntryId(suggestion)
    if (!suggestion || !entryId) return false
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
    if (!suggestions.value.length) return
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      void moveSelection(event.key === 'ArrowDown' ? 1 : -1)
      return
    }
    if (event.key === 'Enter' && visible.value && selected.value) {
      event.preventDefault()
      void chooseSuggestion(selected.value)
    }
  }

  function syncOverlay(): void {
    if (disposed) return
    const overlay = options.overlay
    if (!overlay) return
    if (!visible.value || !form.value) {
      overlay.hide()
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
      suggestions: presentedSuggestions,
      selectedIndex: selection.value,
      theme: options.theme(),
      locale: options.locale()
    })
  }

  function handleResize(): void {
    syncOverlay()
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
    () => watch(
      [visible, suggestions, selection, options.theme, options.locale],
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
          dirty.value = false
        }
      },
      { immediate: true }
    )
  ]
  const overlay = options.overlay
  if (overlay) {
    registrations.push(
      () => overlay.onSelected(({ sessionId, suggestionId, disposition }) => {
        if (disposed || sessionId !== overlaySessionId) return
        const activeTab = options.activeTab.value
        // A row picked for another tab does nothing. A pick for this tab opens even when the tab's own page has changed
        // its address since, as a page still loading or one that moves its address to the section in view does, just as
        // Enter on the row opens it. Such a click did nothing before.
        if (!activeTab || activeTab.id !== presentedSuggestionOwner?.id) return
        const suggestion = presentedSuggestions.find((candidate) => candidate.id === suggestionId)
        if (!suggestion) return
        // A middle-click or Ctrl+click opens the row in a new tab, as Alt+Enter on it does.
        if (disposition) void openInNewTab(suggestion.url, disposition === 'new-background-tab')
        else void chooseSuggestion(suggestion)
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
    focused,
    dirty,
    suggestionId,
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
