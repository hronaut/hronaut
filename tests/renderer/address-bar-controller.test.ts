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
  onRemoveVisit?: (entryId: string) => Promise<unknown>
  selectedUnsubscribe?: () => void
  dismissedRegistrationError?: Error
} = {}) {
  const activeTab = ref(options.activeTab ?? tab('first'))
  const bookmarks = ref(options.bookmarks ?? [])
  const history = ref(options.history ?? [])
  const onOpen = vi.fn()
  const onNavigate = vi.fn(options.onNavigate ?? (async () => undefined))
  const onFocusLeft = vi.fn()
  const onRemoveVisit = vi.fn(options.onRemoveVisit ?? (async () => undefined))
  const onRemoveVisitFailed = vi.fn()
  const onOpenInNewTab = vi.fn(async (_address: string, _background: boolean) => undefined)
  let selectedListener: ((selection: AddressSuggestionSelection) => void) | undefined
  let dismissedListener: ((sessionId: number) => void) | undefined
  const unsubscribeSelected = vi.fn(options.selectedUnsubscribe ?? (() => undefined))
  const unsubscribeDismissed = vi.fn()
  const overlay = {
    show: vi.fn<(request: AddressSuggestionOverlayRequest) => void>(),
    hide: vi.fn(),
    returnFocus: vi.fn(),
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
        onOpenInNewTab,
        onRemoveVisit,
        onRemoveVisitFailed,
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
    history,
    overlay,
    onOpen,
    onNavigate,
    onOpenInNewTab,
    onFocusLeft,
    onRemoveVisit,
    onRemoveVisitFailed,
    unsubscribeSelected,
    unsubscribeDismissed,
    selectOverlay: (suggestionId: string, sessionId = overlay.show.mock.calls.at(-1)?.[0].sessionId ?? 0) => selectedListener?.({ sessionId, suggestionId }),
    middleClickOverlay: (suggestionId: string) => selectedListener?.({
      sessionId: overlay.show.mock.calls.at(-1)?.[0].sessionId ?? 0, suggestionId, disposition: 'new-background-tab'
    }),
    dismissOverlay: (sessionId = overlay.show.mock.calls.at(-1)?.[0].sessionId ?? 0) => dismissedListener?.(sessionId)
  }
}

afterEach(() => vi.useRealTimers())

function visit(id: string): BrowserHistoryEntry {
  return { id, title: `Page ${id}`, url: `https://${id}.example/`, visitedAt: '2026-09-28T00:00:00.000Z', visitCount: 1 }
}

function shiftDelete(init: KeyboardEventInit = {}): KeyboardEvent {
  return new KeyboardEvent('keydown', { key: 'Delete', shiftKey: true, cancelable: true, ...init })
}

/** Opens the suggestions for an empty address and highlights the row this many Down presses reach. */
async function highlight(presses: number): Promise<HTMLElement> {
  const input = screen.getByRole('textbox', { name: 'Address' })
  await fireEvent.focus(input)
  await fireEvent.update(input, '')
  for (let press = 0; press < presses; press++) await fireEvent.keyDown(input, { key: 'ArrowDown' })
  return input
}

describe('address bar controller', () => {
  it('keeps the selected destination when live history reorders suggestions', async () => {
    const first: BrowserHistoryEntry = { id: 'first', title: 'First page', url: 'https://first.example/', visitedAt: '2026-09-28T00:00:00.000Z', visitCount: 1 }
    const second: BrowserHistoryEntry = { ...first, id: 'second', title: 'Second page', url: 'https://second.example/' }
    const rendered = createHarness({ history: [first, second] })
    const input = screen.getByRole('textbox', { name: 'Address' })
    await fireEvent.focus(input)
    await fireEvent.update(input, '')
    await fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(rendered.controller.selected.value?.id).toBe('history:first')

    rendered.history.value = [second, first]
    // Enter can arrive before the next render; selection must already be current.
    rendered.controller.handleKeydown(new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }))
    await nextTick()
    expect(rendered.onNavigate).toHaveBeenCalledWith(first.url)
  })

  it('clears selection when a live update removes or retargets the selected suggestion', async () => {
    const entry: BrowserHistoryEntry = { id: 'first', title: 'First page', url: 'https://first.example/', visitedAt: '2026-09-28T00:00:00.000Z', visitCount: 1 }
    const rendered = createHarness({ history: [entry] })
    const input = screen.getByRole('textbox', { name: 'Address' })
    await fireEvent.focus(input)
    await fireEvent.update(input, '')
    await fireEvent.keyDown(input, { key: 'ArrowDown' })

    rendered.history.value = [{ ...entry, url: 'https://replacement.example/' }]
    expect(rendered.controller.selection.value).toBe(-1)
    rendered.controller.handleKeydown(new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }))
    expect(rendered.onNavigate).not.toHaveBeenCalled()

    await fireEvent.keyDown(input, { key: 'ArrowDown' })
    rendered.history.value = [{ ...entry, id: 'replacement' }]
    expect(rendered.controller.selection.value).toBe(-1)
    expect(rendered.controller.selected.value).toBeUndefined()
  })

  it('forgets the highlighted visit with Shift+Delete and highlights the row in its place at once, as in Chrome', async () => {
    // Chrome's address bar forgets a suggested visit with Shift+Delete; Hronaut's kept every visit it suggested.
    const rendered = createHarness({ history: [visit('first'), visit('second'), visit('third')] })
    await highlight(2)
    expect(rendered.controller.selected.value?.id).toBe('history:second')

    const forget = shiftDelete()
    rendered.controller.handleKeydown(forget)
    expect(forget.defaultPrevented).toBe(true)
    expect(rendered.onRemoveVisit).toHaveBeenCalledExactlyOnceWith('second')
    // The row leaves before history saves the change, so Enter opens the row in its place.
    expect(rendered.controller.suggestions.value.map(suggestion => suggestion.id)).toEqual(['history:first', 'history:third'])
    expect(rendered.controller.selected.value?.id).toBe('history:third')
    rendered.history.value = [visit('first'), visit('third')]
    expect(rendered.controller.selected.value?.id).toBe('history:third')
    rendered.controller.handleKeydown(new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }))
    await nextTick()
    expect(rendered.onNavigate).toHaveBeenCalledWith('https://third.example/')
  })

  it('forgets one visit for a held key and leaves the text alone while it repeats', async () => {
    const bookmark: BrowserBookmark = { id: 'saved', title: 'Page saved', url: 'https://saved.example/', createdAt: '2026-09-28T00:00:00.000Z', updatedAt: '2026-09-28T00:00:00.000Z' }
    const rendered = createHarness({ history: [visit('first')], bookmarks: [bookmark] })
    await highlight(1)
    rendered.controller.handleKeydown(shiftDelete())
    // The bookmark takes the visit's place; the key's repeats neither forget more nor cut the text.
    expect(rendered.controller.selected.value?.id).toBe('bookmark:saved')
    const repeat = shiftDelete({ repeat: true })
    rendered.controller.handleKeydown(repeat)
    expect(repeat.defaultPrevented).toBe(true)
    expect(rendered.onRemoveVisit).toHaveBeenCalledOnce()

    // A repeat of a key that forgot nothing edits the text as usual.
    const fresh = shiftDelete()
    rendered.controller.handleKeydown(fresh)
    const repeatAfterBookmark = shiftDelete({ repeat: true })
    rendered.controller.handleKeydown(repeatAfterBookmark)
    expect([fresh.defaultPrevented, repeatAfterBookmark.defaultPrevented]).toEqual([false, false])
  })

  it('swallows the repeats once the last visit is forgotten and the list closes', async () => {
    const rendered = createHarness({ history: [visit('only')] })
    await highlight(1)
    rendered.controller.handleKeydown(shiftDelete())
    expect(rendered.controller.suggestions.value).toEqual([])
    expect(rendered.controller.selection.value).toBe(-1)
    const repeat = shiftDelete({ repeat: true })
    rendered.controller.handleKeydown(repeat)
    expect(repeat.defaultPrevented).toBe(true)
  })

  it('keeps the highlight on the row in place of the forgotten visit when a new visit arrives first', async () => {
    let settle!: () => void
    const rendered = createHarness({
      history: [visit('first'), visit('second'), visit('third')],
      onRemoveVisit: () => new Promise<void>(resolve => { settle = resolve })
    })
    await highlight(2)
    rendered.controller.handleKeydown(shiftDelete())
    // An agent's visit lands while history saves the change, and then the change itself.
    rendered.history.value = [visit('new'), visit('first'), visit('second'), visit('third')]
    expect(rendered.controller.selected.value?.id).toBe('history:third')
    rendered.history.value = [visit('new'), visit('first'), visit('third')]
    settle()
    await nextTick()
    expect(rendered.controller.selected.value?.id).toBe('history:third')
  })

  it('keeps bookmarks, unhighlighted rows, plain Delete and other modifiers for editing the address', async () => {
    const bookmark: BrowserBookmark = { id: 'saved', title: 'Page saved', url: 'https://saved.example/', createdAt: '2026-09-28T00:00:00.000Z', updatedAt: '2026-09-28T00:00:00.000Z' }
    const rendered = createHarness({ history: [visit('first')], bookmarks: [bookmark] })
    const input = screen.getByRole('textbox', { name: 'Address' })
    await fireEvent.focus(input)
    await fireEvent.update(input, '')
    const unhighlighted = shiftDelete()
    rendered.controller.handleKeydown(unhighlighted)
    await fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(rendered.controller.selected.value?.id).toBe('history:first')
    const kept = [
      new KeyboardEvent('keydown', { key: 'Delete', cancelable: true }),
      new KeyboardEvent('keydown', { key: 'Backspace', shiftKey: true, cancelable: true }),
      shiftDelete({ ctrlKey: true }),
      shiftDelete({ altKey: true }),
      shiftDelete({ metaKey: true })
    ]
    for (const event of kept) rendered.controller.handleKeydown(event)
    await fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(rendered.controller.selected.value?.id).toBe('bookmark:saved')
    const onBookmark = shiftDelete()
    rendered.controller.handleKeydown(onBookmark)
    expect([unhighlighted, ...kept, onBookmark].map(event => event.defaultPrevented)).toEqual([false, false, false, false, false, false, false])
    expect(rendered.onRemoveVisit).not.toHaveBeenCalled()
    expect(rendered.controller.suggestions.value).toHaveLength(2)
  })

  it('brings a visit it could not forget back and reports it, keeping the highlight the person moved to', async () => {
    const failure = new Error('history file is read-only')
    let fail!: () => void
    const rendered = createHarness({
      history: [visit('first'), visit('kept'), visit('third')],
      onRemoveVisit: () => new Promise<void>((_resolve, reject) => { fail = () => reject(failure) })
    })
    const input = await highlight(2)
    rendered.controller.handleKeydown(shiftDelete())
    expect(rendered.controller.selected.value?.id).toBe('history:third')
    await fireEvent.keyDown(input, { key: 'ArrowUp' })
    expect(rendered.controller.selected.value?.id).toBe('history:first')

    fail()
    await waitFor(() => expect(rendered.onRemoveVisitFailed).toHaveBeenCalledWith(failure))
    expect(rendered.controller.suggestions.value.map(suggestion => suggestion.id)).toEqual(['history:first', 'history:kept', 'history:third'])
    expect(rendered.controller.selected.value?.id).toBe('history:first')
  })

  it('reports nothing for a visit it could not forget once the address bar is gone', async () => {
    let fail!: () => void
    const rendered = createHarness({
      history: [visit('first')],
      onRemoveVisit: () => new Promise<void>((_resolve, reject) => { fail = () => reject(new Error('late')) })
    })
    await highlight(1)
    rendered.controller.handleKeydown(shiftDelete())
    rendered.view.unmount()
    fail()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(rendered.onRemoveVisitFailed).not.toHaveBeenCalled()
  })

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

  it('stops counting as focused when focus leaves, even if a tab change cancels the rest of the blur', async () => {
    vi.useFakeTimers()
    const rendered = createHarness()
    const input = screen.getByRole('textbox', { name: 'Address' })
    await fireEvent.focus(input)
    expect(rendered.controller.focused.value).toBe(true)

    // Ctrl+W or Ctrl+Tab from the field: main focuses the page and sends the new tab before the blur timer runs.
    await fireEvent.focusOut(input, { relatedTarget: null })
    rendered.activeTab.value = tab('second')
    await nextTick()
    await vi.runAllTimersAsync()

    expect(rendered.controller.focused.value).toBe(false)
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

  it('opens a suggestion in a new tab behind for a middle-click on its row, and gives the field the keyboard back', async () => {
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
    const hidden = rendered.overlay.hide.mock.calls.length

    rendered.middleClickOverlay('bookmark:saved')
    await Promise.resolve()
    expect(rendered.onOpenInNewTab).toHaveBeenCalledExactlyOnceWith('https://saved.example/', true)
    expect(rendered.onNavigate).not.toHaveBeenCalled()
    // The press gave the suggestions view the keyboard; the field takes it back with the typed text and its
    // suggestions, as Chrome keeps the address bar's own after opening a tab behind.
    expect(rendered.overlay.returnFocus).toHaveBeenCalledOnce()
    expect(input).toHaveValue('saved')
    expect(rendered.overlay.hide).toHaveBeenCalledTimes(hidden)
  })

  it('opens a row once when its pick arrives twice, as its click follows its press', async () => {
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
    rendered.selectOverlay('bookmark:saved')
    rendered.selectOverlay('bookmark:saved')
    await waitFor(() => expect(rendered.onNavigate).toHaveBeenCalledWith('https://saved.example/'))
    expect(rendered.onNavigate).toHaveBeenCalledOnce()
    expect(rendered.onOpenInNewTab).not.toHaveBeenCalled()
  })

  it.each(['within the page', 'in a redirect'] as const)('opens a picked suggestion after the tab\'s page moves its address %s', async (change) => {
    // Clicking a row did nothing once the page moved its address, as a page still loading or one that moves its
    // address to the section in view does, while Enter on the same row opened it.
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

    const current = rendered.activeTab.value
    rendered.activeTab.value = {
      ...current,
      url: change === 'in a redirect' ? 'https://example.test/landing' : `${current.url}#setup`,
      navigationGeneration: current.navigationGeneration + 1
    }
    await nextTick()
    rendered.selectOverlay(request!.suggestions[0].id)
    await Promise.resolve()

    expect(rendered.onNavigate).toHaveBeenCalledWith('https://saved.example/')
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

  for (const closeWith of ['Escape', 'dismissal'] as const) {
    for (const key of ['ArrowDown', 'ArrowUp'] as const) {
      it.each(['dismissal', 'selection'] as const)(`rejects a stale %s when ${key} reopens after ${closeWith}`, async stale => {
        const rendered = createHarness({
          activeTab: tab('blank', 'about:blank'),
          bookmarks: ['first', 'second'].map(id => ({ id, title: id, url: `https://${id}.example/`, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' }))
        })
        const input = screen.getByRole<HTMLInputElement>('textbox', { name: 'Address' })
        await fireEvent.focus(input)
        await fireEvent.keyDown(input, { key: 'ArrowDown' })
        await waitFor(() => expect(rendered.overlay.show).toHaveBeenCalled())
        const previous = rendered.overlay.show.mock.calls.at(-1)![0]
        if (closeWith === 'Escape') await fireEvent.keyDown(input, { key: 'Escape' })
        else rendered.dismissOverlay(previous.sessionId)
        await nextTick()
        const shown = rendered.overlay.show.mock.calls.length
        await fireEvent.keyDown(input, { key })
        await waitFor(() => expect(rendered.overlay.show.mock.calls.length).toBeGreaterThan(shown))
        const reopened = rendered.overlay.show.mock.calls.at(-1)![0]
        if (stale === 'dismissal') rendered.dismissOverlay(previous.sessionId)
        else rendered.selectOverlay(previous.suggestions[0].id, previous.sessionId)
        await nextTick()
        expect(rendered.onNavigate).not.toHaveBeenCalled()
        expect(rendered.controller.open.value).toBe(true)
        expect(reopened.sessionId).not.toBe(previous.sessionId)
        const index = key === 'ArrowDown' ? 0 : reopened.suggestions.length - 1
        expect(reopened.selectedIndex).toBe(index)
        // Moving within the new popup retains its session and updates selection.
        await fireEvent.keyDown(input, { key })
        expect(rendered.overlay.show.mock.calls.at(-1)![0].sessionId).toBe(reopened.sessionId)
        rendered.selectOverlay(reopened.suggestions[index].id, reopened.sessionId)
        await nextTick()
        expect(rendered.onNavigate).toHaveBeenCalledExactlyOnceWith(reopened.suggestions[index].url)
      })
    }
  }

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
