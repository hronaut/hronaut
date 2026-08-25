import { fireEvent, render, screen, waitFor } from '@testing-library/vue'
import { computed, defineComponent, nextTick, ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useAddressBarController } from '../../src/renderer/src/composables/useAddressBarController.js'
import type { AddressSuggestionOverlayRequest } from '../../src/shared/address-suggestions.js'
import type { BrowserBookmark, BrowserHistoryEntry, BrowserTabState } from '../../src/shared/types.js'

function tab(id: string, url = `https://example.test/${id}`): BrowserTabState {
  return {
    id,
    title: `Page ${id}`,
    url,
    loading: false,
    canGoBack: false,
    canGoForward: false,
    active: true,
    pinned: false,
    sleeping: false,
    humanInteractionLocked: false,
    preserveDiagnosticLogs: false,
    zoomPercent: 100,
    audible: false,
    muted: false,
    devToolsOpen: false
  }
}

function createHarness(options: {
  activeTab?: BrowserTabState
  bookmarks?: BrowserBookmark[]
  history?: BrowserHistoryEntry[]
} = {}) {
  const activeTab = ref(options.activeTab ?? tab('first'))
  const bookmarks = ref(options.bookmarks ?? [])
  const history = ref(options.history ?? [])
  const onOpen = vi.fn()
  const onNavigate = vi.fn(async () => undefined)
  const onFocusLeft = vi.fn()
  let selectedListener: ((id: string) => void) | undefined
  let dismissedListener: (() => void) | undefined
  const unsubscribeSelected = vi.fn()
  const unsubscribeDismissed = vi.fn()
  const overlay = {
    show: vi.fn<(request: AddressSuggestionOverlayRequest) => void>(),
    hide: vi.fn(),
    onSelected: vi.fn((listener: (id: string) => void) => {
      selectedListener = listener
      return unsubscribeSelected
    }),
    onDismissed: vi.fn((listener: () => void) => {
      dismissedListener = listener
      return unsubscribeDismissed
    })
  }
  let controller!: ReturnType<typeof useAddressBarController>
  const Harness = defineComponent({
    setup() {
      controller = useAddressBarController({
        activeTab: computed(() => activeTab.value),
        bookmarks,
        history,
        overlay,
        theme: () => 'dark',
        locale: () => 'en-US',
        translate: (key, parameters) => parameters?.count ? `${key}:${parameters.count}` : key,
        formatNumber: String,
        onOpen,
        onNavigate,
        onFocusLeft
      })
      return controller
    },
    template: `
      <form ref="form" @submit.prevent="submit" @focusout="handleFocusOut">
        <input ref="input" v-model="address" aria-label="Address" @focus="handleFocus" @input="handleInput" @keydown="handleKeydown" />
        <span v-for="suggestion in suggestions" :id="suggestionId(suggestion)" :key="suggestion.id">{{ suggestion.title }}</span>
      </form>
    `
  })
  const view = render(Harness)
  return {
    view,
    controller,
    activeTab,
    overlay,
    onOpen,
    onNavigate,
    onFocusLeft,
    unsubscribeSelected,
    unsubscribeDismissed,
    selectOverlay: (id: string) => selectedListener?.(id),
    dismissOverlay: () => dismissedListener?.()
  }
}

afterEach(() => vi.useRealTimers())

describe('address bar controller', () => {
  it('preserves a dirty edit through redirects and restores the committed URL on blur', async () => {
    vi.useFakeTimers()
    const rendered = createHarness()
    const input = screen.getByRole('textbox', { name: 'Address' })
    await nextTick()
    expect(input).toHaveValue('https://example.test/first')

    await fireEvent.focus(input)
    await fireEvent.update(input, 'https://typed.example/path')
    rendered.activeTab.value = tab('first', 'https://redirected.example/final')
    await nextTick()

    expect(input).toHaveValue('https://typed.example/path')
    await fireEvent.focusOut(input)
    await vi.runAllTimersAsync()
    await nextTick()
    expect(input).toHaveValue('https://redirected.example/final')
  })

  it('discards an edit and closes native suggestions when the active tab changes', async () => {
    const rendered = createHarness({
      bookmarks: [{ id: 'saved', title: 'Saved page', url: 'https://saved.example/', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }]
    })
    const input = screen.getByRole('textbox', { name: 'Address' })
    await fireEvent.focus(input)
    await fireEvent.update(input, 'saved')
    await waitFor(() => expect(rendered.overlay.show).toHaveBeenCalled())

    rendered.activeTab.value = tab('second')
    await nextTick()

    expect(input).toHaveValue('https://example.test/second')
    expect(rendered.controller.open.value).toBe(false)
    expect(rendered.overlay.hide).toHaveBeenCalled()
  })

  it('uses Escape to restore the active URL instead of leaving an uncommitted query', async () => {
    const rendered = createHarness()
    const input = screen.getByRole('textbox', { name: 'Address' })
    await fireEvent.focus(input)
    await fireEvent.update(input, 'unfinished search')

    await fireEvent.keyDown(input, { key: 'Escape' })

    expect(input).toHaveValue('https://example.test/first')
    expect(rendered.controller.open.value).toBe(false)
    expect(rendered.onNavigate).not.toHaveBeenCalled()
  })

  it('keeps the composed address and selection untouched while an IME owns the key', async () => {
    const rendered = createHarness({
      bookmarks: [{ id: 'saved', title: 'Saved page', url: 'https://saved.example/', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }]
    })
    const input = screen.getByRole('textbox', { name: 'Address' })
    await fireEvent.focus(input)
    await fireEvent.update(input, 'saved')
    await waitFor(() => expect(rendered.controller.suggestions.value).toHaveLength(1))

    rendered.controller.handleKeydown(new KeyboardEvent('keydown', { key: 'ArrowDown', isComposing: true }))
    rendered.controller.handleKeydown(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true }))
    rendered.controller.handleKeydown(new KeyboardEvent('keydown', { key: 'Escape', isComposing: true }))
    await Promise.resolve()

    expect(input).toHaveValue('saved')
    expect(rendered.controller.selection.value).toBe(-1)
    expect(rendered.controller.open.value).toBe(true)
    expect(rendered.onNavigate).not.toHaveBeenCalled()
  })

  it('keeps the last native suggestion selectable after focus loss restores the address', async () => {
    vi.useFakeTimers()
    const saved: BrowserBookmark = { id: 'saved', title: 'Saved page', url: 'https://saved.example/', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }
    const rendered = createHarness({ bookmarks: [saved] })
    const input = screen.getByRole('textbox', { name: 'Address' })
    await fireEvent.focus(input)
    await fireEvent.update(input, 'saved')
    await waitFor(() => expect(rendered.overlay.show).toHaveBeenCalled())
    const request = rendered.overlay.show.mock.calls.at(-1)?.[0]
    expect(request?.suggestions).toHaveLength(1)

    await fireEvent.focusOut(input)
    await vi.runAllTimersAsync()
    expect(input).toHaveValue('https://example.test/first')
    rendered.selectOverlay(request!.suggestions[0].id)

    await vi.waitFor(() => expect(rendered.onNavigate).toHaveBeenCalledWith(saved.url))
    expect(input).toHaveValue(saved.url)
  })

  it('acknowledges native dismissal and disposes both overlay subscriptions', async () => {
    const rendered = createHarness({
      bookmarks: [{ id: 'saved', title: 'Saved page', url: 'https://saved.example/', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }]
    })
    const input = screen.getByRole('textbox', { name: 'Address' })
    await fireEvent.focus(input)
    await fireEvent.update(input, 'saved')
    expect(rendered.controller.open.value).toBe(true)

    rendered.dismissOverlay()
    expect(rendered.controller.open.value).toBe(false)
    expect(rendered.overlay.hide).toHaveBeenCalled()

    rendered.view.unmount()
    expect(rendered.unsubscribeSelected).toHaveBeenCalledOnce()
    expect(rendered.unsubscribeDismissed).toHaveBeenCalledOnce()
  })
})
