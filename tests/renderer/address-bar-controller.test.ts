import { fireEvent, render, screen, waitFor } from '@testing-library/vue'
import { computed, defineComponent, nextTick, ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useAddressBarController } from '../../src/renderer/src/composables/useAddressBarController.js'
import type { AddressSuggestionOverlayRequest, AddressSuggestionSelection } from '../../src/shared/address-suggestions.js'
import type { BrowserBookmark, BrowserHistoryEntry, BrowserTabState } from '../../src/shared/types.js'

function tab(id: string, url = `https://example.test/${id}`): BrowserTabState {
  return {
    id,
    title: `Page ${id}`,
    url,
    loading: false,
    navigationGeneration: 0,
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
  onNavigate?: (address: string) => Promise<void>
  selectedUnsubscribe?: () => void
  dismissedRegistrationError?: Error
} = {}) {
  const activeTab = ref(options.activeTab ?? tab('first'))
  const bookmarks = ref(options.bookmarks ?? [])
  const history = ref(options.history ?? [])
  const onOpen = vi.fn()
  const onNavigate = vi.fn(options.onNavigate ?? (async () => undefined))
  const onFocusLeft = vi.fn()
  let selectedListener: ((selection: AddressSuggestionSelection) => void) | undefined
  let dismissedListener: ((sessionId: number) => void) | undefined
  const unsubscribeSelected = vi.fn(options.selectedUnsubscribe ?? (() => undefined))
  const unsubscribeDismissed = vi.fn()
  const overlay = {
    show: vi.fn<(request: AddressSuggestionOverlayRequest) => void>(),
    hide: vi.fn(),
    onSelected: vi.fn((listener: (selection: AddressSuggestionSelection) => void) => {
      selectedListener = listener
      return unsubscribeSelected
    }),
    onDismissed: vi.fn((listener: (sessionId: number) => void) => {
      dismissedListener = listener
      return unsubscribeDismissed
    })
  }
  const dismissedRegistrationError = options.dismissedRegistrationError
  if (dismissedRegistrationError) {
    overlay.onDismissed.mockImplementationOnce(() => {
      throw dismissedRegistrationError
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
    selectOverlay: (suggestionId: string, sessionId = overlay.show.mock.calls.at(-1)?.[0].sessionId ?? 0) => selectedListener?.({ sessionId, suggestionId }),
    dismissOverlay: (sessionId = overlay.show.mock.calls.at(-1)?.[0].sessionId ?? 0) => dismissedListener?.(sessionId)
  }
}

afterEach(() => vi.useRealTimers())

describe('address bar controller', () => {
  it('keeps a submitted address visible until the current tab commits navigation', async () => {
    vi.useFakeTimers()
    let finishNavigation!: () => void
    const navigation = new Promise<void>((resolve) => {
      finishNavigation = resolve
    })
    const rendered = createHarness({
      activeTab: tab('first', 'hronaut://home'),
      onNavigate: async () => navigation
    })
    const input = screen.getByRole<HTMLInputElement>('textbox', { name: 'Address' })
    const targetUrl = 'https://typed.example/pending'
    await fireEvent.focus(input)
    await fireEvent.update(input, targetUrl)

    const submission = rendered.controller.submit()
    await vi.runAllTimersAsync()

    expect(input).toHaveValue(targetUrl)
    rendered.activeTab.value = tab('first', targetUrl)
    await nextTick()
    expect(input).toHaveValue(targetUrl)

    finishNavigation()
    await submission
  })

  it('preserves an address selection when the current page commits before typing starts', async () => {
    const rendered = createHarness()
    const input = screen.getByRole<HTMLInputElement>('textbox', { name: 'Address' })
    await nextTick()

    await fireEvent.focus(input)
    input.select()
    rendered.activeTab.value = tab('first', 'https://redirected.example/final')
    await nextTick()

    expect(input).toHaveValue('https://example.test/first')
    expect(input.selectionStart).toBe(0)
    expect(input.selectionEnd).toBe('https://example.test/first'.length)

    await fireEvent.update(input, 'person@example.com')
    await fireEvent.submit(input.closest('form')!)

    expect(rendered.onNavigate).toHaveBeenCalledWith('person@example.com')
  })

  it('preserves a dirty edit through redirects, focus loss, and refocus', async () => {
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
    expect(input).toHaveValue('https://typed.example/path')
    expect(rendered.controller.dirty.value).toBe(true)
    expect(rendered.controller.focused.value).toBe(false)
    expect(rendered.controller.open.value).toBe(false)

    await fireEvent.focus(input)
    await fireEvent.focusOut(input)
    await vi.runAllTimersAsync()
    expect(input).toHaveValue('https://typed.example/path')
    rendered.activeTab.value = tab('first', 'https://redirected.example/later')
    await nextTick()
    expect(input).toHaveValue('https://typed.example/path')
  })

  it('restores the committed URL after focus loss when there is no typed draft', async () => {
    vi.useFakeTimers()
    const rendered = createHarness()
    const input = screen.getByRole('textbox', { name: 'Address' })
    await fireEvent.focus(input)
    rendered.activeTab.value = tab('first', 'https://redirected.example/final')
    await nextTick()
    await fireEvent.focusOut(input)
    await vi.runAllTimersAsync()

    expect(input).toHaveValue('https://redirected.example/final')
    expect(rendered.controller.dirty.value).toBe(false)
  })

  it('preserves a newer draft when an earlier navigation completes', async () => {
    let finishNavigation!: () => void
    const rendered = createHarness({ onNavigate: () => new Promise<void>(resolve => { finishNavigation = resolve }) })
    const input = screen.getByRole('textbox', { name: 'Address' })
    await fireEvent.focus(input)
    await fireEvent.update(input, 'first destination')
    const submission = rendered.controller.submit()

    await fireEvent.focus(input)
    await fireEvent.update(input, 'second unfinished destination')
    finishNavigation()
    await submission

    expect(input).toHaveValue('second unfinished destination')
    expect(rendered.controller.dirty.value).toBe(true)
  })

  it('uses Escape to discard a draft even after the suggestion popup was dismissed', async () => {
    const rendered = createHarness()
    const input = screen.getByRole('textbox', { name: 'Address' })
    await fireEvent.focus(input)
    await fireEvent.update(input, 'unfinished search')
    rendered.dismissOverlay()

    await fireEvent.keyDown(input, { key: 'Escape' })

    expect(input).toHaveValue('https://example.test/first')
    expect(rendered.controller.dirty.value).toBe(false)
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

  it('ignores a delayed native suggestion selection after the active tab changes', async () => {
    const saved: BrowserBookmark = {
      id: 'saved',
      title: 'Saved page',
      url: 'https://saved.example/',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z'
    }
    const rendered = createHarness({ bookmarks: [saved] })
    const input = screen.getByRole('textbox', { name: 'Address' })
    await fireEvent.focus(input)
    await fireEvent.update(input, 'saved')
    await waitFor(() => expect(rendered.overlay.show).toHaveBeenCalled())
    const request = rendered.overlay.show.mock.calls.at(-1)?.[0]
    expect(request?.suggestions).toHaveLength(1)

    rendered.activeTab.value = tab('second', 'https://second.example/unsaved-form')
    await nextTick()
    rendered.selectOverlay(request!.suggestions[0].id)
    await Promise.resolve()

    expect(rendered.onNavigate).not.toHaveBeenCalled()
    expect(input).toHaveValue('https://second.example/unsaved-form')
  })

  it('ignores a delayed native selection after Escape cancels the address search', async () => {
    const saved: BrowserBookmark = { id: 'saved', title: 'Saved page', url: 'https://saved.example/', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }
    const rendered = createHarness({ bookmarks: [saved] })
    const input = screen.getByRole<HTMLInputElement>('textbox', { name: 'Address' })
    await fireEvent.focus(input)
    await fireEvent.update(input, 'saved')
    await waitFor(() => expect(rendered.overlay.show).toHaveBeenCalled())
    const suggestionId = rendered.overlay.show.mock.calls.at(-1)![0].suggestions[0].id

    await fireEvent.keyDown(input, { key: 'Escape' })
    rendered.selectOverlay(suggestionId)
    await Promise.resolve()

    expect(input).toHaveValue('https://example.test/first')
    expect(rendered.onNavigate).not.toHaveBeenCalled()
  })

  it('ignores a delayed native selection after the popup is dismissed', async () => {
    const saved: BrowserBookmark = { id: 'saved', title: 'Saved page', url: 'https://saved.example/', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }
    const rendered = createHarness({ bookmarks: [saved] })
    const input = screen.getByRole<HTMLInputElement>('textbox', { name: 'Address' })
    await fireEvent.focus(input)
    await fireEvent.update(input, 'saved')
    await waitFor(() => expect(rendered.overlay.show).toHaveBeenCalled())
    const suggestionId = rendered.overlay.show.mock.calls.at(-1)![0].suggestions[0].id

    rendered.dismissOverlay()
    rendered.selectOverlay(suggestionId)
    await Promise.resolve()

    expect(rendered.onNavigate).not.toHaveBeenCalled()
    expect(input).toHaveValue('saved')
  })

  it('ignores a delayed native selection after another control closes suggestions', async () => {
    const saved: BrowserBookmark = { id: 'saved', title: 'Saved page', url: 'https://saved.example/', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }
    const rendered = createHarness({ bookmarks: [saved] })
    const input = screen.getByRole<HTMLInputElement>('textbox', { name: 'Address' })
    await fireEvent.focus(input)
    await fireEvent.update(input, 'saved')
    await waitFor(() => expect(rendered.overlay.show).toHaveBeenCalled())
    const request = rendered.overlay.show.mock.calls.at(-1)![0]

    rendered.controller.close()
    rendered.selectOverlay(request.suggestions[0].id, request.sessionId)
    await Promise.resolve()

    expect(rendered.onNavigate).not.toHaveBeenCalled()
    expect(input).toHaveValue('saved')
  })

  it('invalidates a pending native selection when the shell closes the shared popup state', async () => {
    vi.useFakeTimers()
    const saved: BrowserBookmark = { id: 'saved', title: 'Saved page', url: 'https://saved.example/', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }
    const rendered = createHarness({ bookmarks: [saved] })
    const input = screen.getByRole<HTMLInputElement>('textbox', { name: 'Address' })
    await fireEvent.focus(input)
    await fireEvent.update(input, 'saved')
    await waitFor(() => expect(rendered.overlay.show).toHaveBeenCalled())
    const request = rendered.overlay.show.mock.calls.at(-1)![0]

    await fireEvent.focusOut(input)
    await vi.runAllTimersAsync()
    rendered.controller.open.value = false
    rendered.selectOverlay(request.suggestions[0].id, request.sessionId)
    await Promise.resolve()

    expect(rendered.onNavigate).not.toHaveBeenCalled()
    expect(input).toHaveValue('saved')
  })

  it('ignores a selection from an earlier popup after reopening the address bar', async () => {
    const saved: BrowserBookmark = { id: 'saved', title: 'Saved page', url: 'https://saved.example/', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }
    const rendered = createHarness({ bookmarks: [saved] })
    const input = screen.getByRole<HTMLInputElement>('textbox', { name: 'Address' })
    await fireEvent.focus(input)
    await fireEvent.update(input, 'saved')
    await waitFor(() => expect(rendered.overlay.show).toHaveBeenCalled())
    const suggestionId = rendered.overlay.show.mock.calls.at(-1)![0].suggestions[0].id

    await fireEvent.focusOut(input)
    rendered.controller.handleFocus()
    rendered.selectOverlay(suggestionId)
    await Promise.resolve()

    expect(rendered.onNavigate).not.toHaveBeenCalled()
  })

  it('ignores an earlier popup selection after the same suggestion is shown again', async () => {
    const saved: BrowserBookmark = { id: 'saved', title: 'Saved page', url: 'https://saved.example/', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }
    const rendered = createHarness({ bookmarks: [saved] })
    const input = screen.getByRole<HTMLInputElement>('textbox', { name: 'Address' })
    await fireEvent.focus(input)
    await fireEvent.update(input, 'saved')
    await waitFor(() => expect(rendered.overlay.show).toHaveBeenCalled())
    const first = rendered.overlay.show.mock.calls.at(-1)![0]

    await fireEvent.focusOut(input)
    await fireEvent.focus(input)
    await waitFor(() => expect(rendered.overlay.show.mock.calls.at(-1)?.[0].sessionId).not.toBe(first.sessionId))
    const reopened = rendered.overlay.show.mock.calls.at(-1)![0]
    expect(reopened.suggestions[0].id).toBe(first.suggestions[0].id)

    rendered.selectOverlay(first.suggestions[0].id, first.sessionId)
    await Promise.resolve()

    expect(rendered.onNavigate).not.toHaveBeenCalled()
    expect(rendered.controller.open.value).toBe(true)
  })

  it('resumes committed URL updates after a tab change discards an edit', async () => {
    const rendered = createHarness()
    const input = screen.getByRole('textbox', { name: 'Address' })
    await fireEvent.focus(input)
    await fireEvent.update(input, 'unfinished search')

    rendered.activeTab.value = tab('second', 'https://second.example/start')
    await nextTick()
    expect(input).toHaveValue('https://second.example/start')

    rendered.activeTab.value = tab('second', 'https://second.example/redirected')
    await nextTick()
    expect(input).toHaveValue('https://second.example/redirected')
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

  it('keeps the last native suggestion selectable after focus loss preserves the draft', async () => {
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
    expect(input).toHaveValue('saved')
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

  it('acknowledges a stale native dismissal before reopening history suggestions', async () => {
    const rendered = createHarness({
      history: [{
        url: 'https://visited.example/path',
        title: 'Previously visited',
        visitCount: 2,
        visitedAt: '2026-01-01T00:00:00.000Z',
        id: 'visited-history'
      }]
    })
    const input = screen.getByRole<HTMLInputElement>('textbox', { name: 'Address' })
    await fireEvent.focus(input)
    await fireEvent.update(input, 'visited')
    await waitFor(() => expect(rendered.overlay.show).toHaveBeenCalled())

    rendered.dismissOverlay()
    rendered.overlay.hide.mockClear()
    rendered.overlay.show.mockClear()
    await fireEvent.update(input, 'visited.example')

    await waitFor(() => expect(rendered.overlay.show).toHaveBeenCalled())
    expect(rendered.overlay.hide.mock.invocationCallOrder[0]).toBeLessThan(
      rendered.overlay.show.mock.invocationCallOrder[0]
    )
    expect(rendered.overlay.show.mock.calls.at(-1)?.[0].suggestions).toEqual([
      expect.objectContaining({ kind: 'history', url: 'https://visited.example/path' })
    ])
  })

  it('keeps a newly reopened popup visible when an earlier dismissal arrives late', async () => {
    const rendered = createHarness({
      bookmarks: [{ id: 'saved', title: 'Saved page', url: 'https://saved.example/', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }]
    })
    const input = screen.getByRole<HTMLInputElement>('textbox', { name: 'Address' })
    await fireEvent.focus(input)
    await fireEvent.update(input, 'saved')
    await waitFor(() => expect(rendered.overlay.show).toHaveBeenCalled())
    const previousPopup = rendered.overlay.show.mock.calls.at(-1)![0]

    rendered.controller.close()
    await nextTick()
    rendered.controller.handleFocus()
    await waitFor(() => expect(rendered.overlay.show.mock.calls.length).toBeGreaterThan(1))
    const reopenedPopup = rendered.overlay.show.mock.calls.at(-1)![0]
    expect(reopenedPopup.sessionId).not.toBe(previousPopup.sessionId)

    rendered.dismissOverlay(previousPopup.sessionId)
    expect(rendered.controller.open.value).toBe(true)
    expect(input).toHaveValue('saved')
  })

  it('rolls back the selected listener when dismissed-listener registration fails', () => {
    const unsubscribeSelected = vi.fn()
    const registrationError = new Error('dismissed listener unavailable')

    expect(() => createHarness({
      selectedUnsubscribe: unsubscribeSelected,
      dismissedRegistrationError: registrationError
    })).toThrow(registrationError)

    expect(unsubscribeSelected).toHaveBeenCalledOnce()
  })

  it('releases every native overlay resource when one unsubscriber throws', () => {
    const rendered = createHarness()
    rendered.unsubscribeSelected.mockImplementationOnce(() => {
      throw new Error('selected listener already closed')
    })
    rendered.overlay.hide.mockClear()

    expect(() => rendered.controller.dispose()).toThrow('selected listener already closed')

    expect(rendered.unsubscribeSelected).toHaveBeenCalledOnce()
    expect(rendered.unsubscribeDismissed).toHaveBeenCalledOnce()
    expect(rendered.overlay.hide).toHaveBeenCalledOnce()
    rendered.view.unmount()
  })

  it('does not reopen the native overlay from a watcher already queued at disposal', async () => {
    const rendered = createHarness({
      bookmarks: [{ id: 'saved', title: 'Saved page', url: 'https://saved.example/', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }]
    })
    rendered.overlay.show.mockClear()
    rendered.controller.address.value = 'saved'
    rendered.controller.open.value = true

    rendered.controller.dispose()
    await nextTick()
    await nextTick()

    expect(rendered.overlay.show).not.toHaveBeenCalled()
    rendered.view.unmount()
  })

  it('ignores a selected event already queued when the native overlay is disposed', async () => {
    const rendered = createHarness({
      bookmarks: [{ id: 'saved', title: 'Saved page', url: 'https://saved.example/', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }]
    })
    rendered.controller.address.value = 'saved'
    const suggestion = rendered.controller.suggestions.value[0]
    expect(suggestion).toBeDefined()

    rendered.controller.dispose()
    rendered.selectOverlay(suggestion.id)
    await Promise.resolve()

    expect(rendered.onNavigate).not.toHaveBeenCalled()
    rendered.view.unmount()
  })
})
