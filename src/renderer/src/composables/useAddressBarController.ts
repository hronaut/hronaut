import { computed, nextTick, onBeforeUnmount, ref, watch, type ComputedRef, type Ref } from 'vue'
import type { AddressSuggestion, AddressSuggestionOverlayRequest, AddressSuggestionOverlayTheme } from '../../../shared/address-suggestions.js'
import { buildLocalAddressSuggestions } from '../../../shared/address-suggestions.js'
import type { SupportedLocale } from '../../../shared/locale.js'
import type { BrowserBookmark, BrowserHistoryEntry, BrowserTabState } from '../../../shared/types.js'
import { isImeCompositionEvent } from '../keyboard-composition.js'

interface AddressOverlayApi {
  show(request: AddressSuggestionOverlayRequest): void
  hide(): void
  onSelected(listener: (suggestionId: string) => void): () => void
  onDismissed(listener: () => void): () => void
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
  onFocusLeft: () => void
}

function displayedAddress(url: string | undefined): string {
  return url === 'about:blank' || url?.startsWith('hronaut://home') ? '' : url ?? ''
}

export function useAddressBarController(options: AddressBarControllerOptions) {
  const address = ref('')
  const input = ref<HTMLInputElement | null>(null)
  const form = ref<HTMLFormElement | null>(null)
  const open = ref(false)
  const selection = ref(-1)
  const focused = ref(false)
  const dirty = ref(false)
  const suggestions = computed(() => buildLocalAddressSuggestions({
    query: address.value,
    bookmarks: options.bookmarks.value,
    history: options.history.value
  }))
  const visible = computed(() => open.value && suggestions.value.length > 0)
  const selected = computed(() => selection.value >= 0 ? suggestions.value[selection.value] : undefined)
  let blurTimer: number | undefined
  let presentedSuggestions: AddressSuggestion[] = []
  let unsubscribeSelected: (() => void) | undefined
  let unsubscribeDismissed: (() => void) | undefined
  let disposed = false

  function suggestionId(suggestion: AddressSuggestion): string {
    return `address-suggestion-${suggestion.id}`
  }

  function suggestionMeta(suggestion: AddressSuggestion): string {
    if (suggestion.kind === 'bookmark') return options.translate('runtime.suggestion.bookmark')
    return suggestion.visitCount && suggestion.visitCount > 1
      ? options.translate('runtime.suggestion.visits', { count: options.formatNumber(suggestion.visitCount) })
      : options.translate('runtime.suggestion.history')
  }

  function cancelBlur(): void {
    if (blurTimer === undefined) return
    window.clearTimeout(blurTimer)
    blurTimer = undefined
  }

  function restoreActiveAddress(): void {
    address.value = displayedAddress(options.activeTab.value?.url)
    dirty.value = false
  }

  function close(): void {
    open.value = false
    options.overlay?.hide()
  }

  function openSuggestions(): void {
    cancelBlur()
    selection.value = -1
    open.value = true
    options.onOpen()
  }

  function handleFocus(): void {
    focused.value = true
    dirty.value = false
    openSuggestions()
  }

  function handleInput(): void {
    focused.value = true
    dirty.value = true
    openSuggestions()
  }

  function finishBlur(): void {
    blurTimer = undefined
    focused.value = false
    if (dirty.value) restoreActiveAddress()
  }

  function handleFocusOut(event: FocusEvent): void {
    const next = event.relatedTarget
    const staysInForm = next instanceof Node && (event.currentTarget as HTMLElement).contains(next)
    const leftInput = event.target === input.value && next !== input.value
    if (leftInput) {
      close()
      cancelBlur()
      blurTimer = window.setTimeout(finishBlur, 0)
    }
    if (!staysInForm) {
      close()
      options.onFocusLeft()
    }
  }

  async function submit(): Promise<void> {
    if (!address.value.trim()) return
    cancelBlur()
    dirty.value = false
    close()
    await options.onNavigate(address.value)
  }

  async function chooseSuggestion(suggestion: AddressSuggestion): Promise<void> {
    cancelBlur()
    address.value = suggestion.url
    dirty.value = false
    close()
    await options.onNavigate(suggestion.url)
  }

  function revealSelected(): void {
    const suggestion = selected.value
    if (!suggestion) return
    document.getElementById(suggestionId(suggestion))?.scrollIntoView?.({ block: 'nearest' })
  }

  async function moveSelection(offset: -1 | 1): Promise<void> {
    const count = suggestions.value.length
    if (!count) return
    if (selection.value < 0) selection.value = offset === 1 ? 0 : count - 1
    else selection.value = (selection.value + offset + count) % count
    open.value = true
    await nextTick()
    revealSelected()
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (isImeCompositionEvent(event)) return
    if (event.key === 'Escape' && open.value) {
      event.preventDefault()
      close()
      restoreActiveAddress()
      input.value?.select()
      return
    }
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
    const overlay = options.overlay
    if (!overlay) return
    if (!visible.value || !form.value) {
      overlay.hide()
      return
    }
    const formBounds = form.value.getBoundingClientRect()
    const viewportMargin = 12
    const availableWidth = Math.max(1, window.innerWidth - viewportMargin * 2)
    const width = Math.min(availableWidth, Math.max(formBounds.width + 2, Math.min(560, availableWidth)))
    const x = Math.max(viewportMargin, Math.min(formBounds.left - 1, window.innerWidth - width - viewportMargin))
    const y = Math.ceil(formBounds.bottom + 7)
    const maxHeight = Math.max(1, Math.min(440, window.innerHeight - y - viewportMargin))
    presentedSuggestions = suggestions.value.map((suggestion) => ({ ...suggestion }))
    overlay.show({
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

  watch(() => suggestions.value.length, async (length) => {
    if (selection.value >= length) selection.value = -1
    await nextTick()
    revealSelected()
  })

  watch(
    [visible, suggestions, selection, options.theme, options.locale],
    async () => {
      await nextTick()
      syncOverlay()
    }
  )

  watch(
    [() => options.activeTab.value?.id, () => options.activeTab.value?.url],
    ([tabId, url], [previousTabId]) => {
      const tabChanged = previousTabId !== undefined && tabId !== previousTabId
      if (tabChanged || !dirty.value) {
        cancelBlur()
        close()
        address.value = displayedAddress(url)
        dirty.value = false
      }
    },
    { immediate: true }
  )

  if (options.overlay) {
    unsubscribeSelected = options.overlay.onSelected((id) => {
      const suggestion = presentedSuggestions.find((candidate) => candidate.id === id)
        ?? suggestions.value.find((candidate) => candidate.id === id)
      if (suggestion) void chooseSuggestion(suggestion)
    })
    unsubscribeDismissed = options.overlay.onDismissed(() => {
      open.value = false
      options.overlay?.hide()
    })
  }

  function dispose(): void {
    if (disposed) return
    disposed = true
    cancelBlur()
    unsubscribeSelected?.()
    unsubscribeDismissed?.()
    options.overlay?.hide()
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
    handleFocusOut,
    handleKeydown,
    submit,
    handleResize,
    dispose
  }
}

export type AddressBarController = ReturnType<typeof useAddressBarController>
