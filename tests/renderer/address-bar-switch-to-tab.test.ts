import { fireEvent, render, screen, waitFor } from '@testing-library/vue'
import { computed, defineComponent, nextTick, ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { useAddressBarController } from '../../src/renderer/src/composables/useAddressBarController.js'
import { ADDRESS_SUGGESTION_URL_MAX_LENGTH, type AddressSuggestionOverlayRequest, type AddressSuggestionSelection } from '../../src/shared/address-suggestions.js'
import type { BrowserHistoryEntry, BrowserTabState } from '../../src/shared/types.js'

// Open tabs were kept out of the address bar, so a page open in another tab could only be opened again. Chrome offers
// Switch to this tab on such a row, reached with Tab, and lists the open tabs with @tabs.

function tab(id: string, url = `https://${id}.example/`, title = `Page ${id}`): BrowserTabState {
  return {
    id,
    title,
    url,
    loading: false,
    navigationGeneration: 0,
    canGoBack: false,
    canGoForward: false,
    active: false,
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

function visit(id: string, url = `https://${id}.example/`): BrowserHistoryEntry {
  return { id, title: `Visit ${id}`, url, visitedAt: '2026-10-25T00:00:00.000Z', visitCount: 1 }
}

function createHarness(options: { tabs: BrowserTabState[]; history: BrowserHistoryEntry[] }) {
  const tabs = ref(options.tabs)
  const activeId = ref(options.tabs[0].id)
  const onNavigate = vi.fn(async (_address: string) => undefined)
  const onOpenInNewTab = vi.fn(async (_address: string, _background: boolean) => undefined)
  const onSwitchToTab = vi.fn(async (_tabId: string) => true)
  let selectedListener: ((selection: AddressSuggestionSelection) => void) | undefined
  const overlay = {
    show: vi.fn<(request: AddressSuggestionOverlayRequest) => void>(),
    hide: vi.fn(),
    returnFocus: vi.fn(),
    onSelected: vi.fn((listener: (selection: AddressSuggestionSelection) => void) => {
      selectedListener = listener
      return () => undefined
    }),
    onDismissed: vi.fn(() => () => undefined)
  }
  let controller!: ReturnType<typeof useAddressBarController>
  const Harness = defineComponent({
    setup() {
      controller = useAddressBarController({
        activeTab: computed(() => tabs.value.find(candidate => candidate.id === activeId.value)),
        tabs,
        bookmarks: ref([]),
        history: ref(options.history),
        overlay,
        theme: () => 'dark',
        locale: () => 'en-US',
        translate: (key) => key,
        formatNumber: String,
        onOpen: vi.fn(),
        onNavigate,
        onOpenInNewTab,
        onSwitchToTab,
        onRemoveVisit: vi.fn(async () => undefined),
        onRemoveVisitFailed: vi.fn(),
        onFocusLeft: vi.fn()
      })
      return controller
    },
    template: `
      <form ref="form" @submit.prevent="submit" @focusout="handleFocusOut">
        <input ref="input" v-model="address" aria-label="Address" @focus="handleFocus" @input="handleInput" @keydown="handleKeydown" />
      </form>
    `
  })
  render(Harness)
  const lastShown = () => overlay.show.mock.calls.at(-1)?.[0]
  return {
    controller,
    tabs,
    overlay,
    onNavigate,
    onOpenInNewTab,
    onSwitchToTab,
    lastShown,
    input: screen.getByRole<HTMLInputElement>('textbox', { name: 'Address' }),
    pick: (suggestionId: string, extra: Partial<AddressSuggestionSelection> = {}) => selectedListener?.({ sessionId: lastShown()!.sessionId, suggestionId, ...extra })
  }
}

async function typeAddress(input: HTMLInputElement, text: string): Promise<void> {
  input.focus()
  await fireEvent.focus(input)
  await fireEvent.update(input, text)
}

async function key(input: HTMLInputElement, init: KeyboardEventInit): Promise<KeyboardEvent> {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
  input.dispatchEvent(event)
  await nextTick()
  await nextTick()
  return event
}

describe('Switch to this tab in the address bar', () => {
  it('goes on from a visit open in another tab to Switch to this tab with Tab, and switches with Enter', async () => {
    const h = createHarness({ tabs: [tab('shown'), tab('docs')], history: [visit('docs'), visit('other')] })
    await typeAddress(h.input, 'example')
    await waitFor(() => expect(h.lastShown()?.suggestions.map(suggestion => [suggestion.id, suggestion.openTabId])).toEqual([
      ['history:docs', 'docs'], ['history:other', undefined]
    ]))
    await key(h.input, { key: 'ArrowDown' })
    const tabKey = await key(h.input, { key: 'Tab' })
    expect(tabKey.defaultPrevented).toBe(true)
    expect(h.controller.switchFocused.value).toBe(true)
    await waitFor(() => expect(h.lastShown()).toMatchObject({ selectedIndex: 0, selectedAction: 'switch-tab' }))
    const enter = await key(h.input, { key: 'Enter' })
    expect(enter.defaultPrevented).toBe(true)
    await waitFor(() => expect(h.onSwitchToTab).toHaveBeenCalledExactlyOnceWith('docs'))
    expect(h.onNavigate).not.toHaveBeenCalled()
    // The shown tab's field has its own address again for when the person comes back, and the suggestions are closed.
    expect(h.input.value).toBe('https://shown.example/')
    expect(h.controller.visible.value).toBe(false)
    expect(h.overlay.hide).toHaveBeenCalled()
  })

  it('comes back to the row with Shift+Tab, or by moving the highlight, where Enter opens the page here', async () => {
    const h = createHarness({ tabs: [tab('shown'), tab('docs'), tab('more', 'https://more.example/')], history: [visit('docs'), visit('more')] })
    await typeAddress(h.input, 'example')
    await key(h.input, { key: 'ArrowDown' })
    await key(h.input, { key: 'Tab' })
    const back = await key(h.input, { key: 'Tab', shiftKey: true })
    expect(back.defaultPrevented).toBe(true)
    expect(h.controller.switchFocused.value).toBe(false)
    await waitFor(() => expect(h.lastShown()).not.toHaveProperty('selectedAction'))
    await key(h.input, { key: 'Tab' })
    expect(h.controller.switchFocused.value).toBe(true)
    await key(h.input, { key: 'ArrowDown' })
    expect(h.controller.switchFocused.value).toBe(false)
    expect(h.controller.selected.value?.id).toBe('history:more')
    await key(h.input, { key: 'Enter' })
    await waitFor(() => expect(h.onNavigate).toHaveBeenCalledExactlyOnceWith('https://more.example/'))
    expect(h.onSwitchToTab).not.toHaveBeenCalled()
  })

  it('goes back from the button when the highlight moves, even with only one row', async () => {
    const h = createHarness({ tabs: [tab('shown'), tab('docs')], history: [visit('docs')] })
    await typeAddress(h.input, 'docs')
    await key(h.input, { key: 'ArrowDown' })
    await key(h.input, { key: 'Tab' })
    expect(h.controller.switchFocused.value).toBe(true)
    await key(h.input, { key: 'ArrowDown' })
    expect(h.controller.selected.value?.id).toBe('history:docs')
    expect(h.controller.switchFocused.value).toBe(false)
    await key(h.input, { key: 'Enter' })
    await waitFor(() => expect(h.onNavigate).toHaveBeenCalledExactlyOnceWith('https://docs.example/'))
    expect(h.onSwitchToTab).not.toHaveBeenCalled()
  })

  it('moves once for a held Tab or Shift+Tab, and keeps the keyboard in the field while the key repeats', async () => {
    const h = createHarness({ tabs: [tab('shown'), tab('docs')], history: [visit('docs')] })
    await typeAddress(h.input, 'docs')
    await key(h.input, { key: 'ArrowDown' })
    expect((await key(h.input, { key: 'Tab' })).defaultPrevented).toBe(true)
    for (let repeat = 0; repeat < 3; repeat += 1) {
      expect((await key(h.input, { key: 'Tab', repeat: true })).defaultPrevented).toBe(true)
    }
    expect(h.controller.switchFocused.value).toBe(true)
    expect(h.controller.visible.value).toBe(true)
    expect((await key(h.input, { key: 'Tab', shiftKey: true })).defaultPrevented).toBe(true)
    expect((await key(h.input, { key: 'Tab', shiftKey: true, repeat: true })).defaultPrevented).toBe(true)
    expect(h.controller.switchFocused.value).toBe(false)
    // A new press from the button moves on from the field, as before.
    await key(h.input, { key: 'Tab' })
    expect((await key(h.input, { key: 'Tab' })).defaultPrevented).toBe(false)
  })

  it('leaves Tab to move on as usual where the highlighted row has no tab to switch to', async () => {
    const h = createHarness({ tabs: [tab('shown'), tab('docs')], history: [visit('docs'), visit('other')] })
    await typeAddress(h.input, 'example')
    // Nothing highlighted yet.
    expect((await key(h.input, { key: 'Tab' })).defaultPrevented).toBe(false)
    await key(h.input, { key: 'ArrowDown' })
    expect((await key(h.input, { key: 'Tab', shiftKey: true })).defaultPrevented).toBe(false)
    expect((await key(h.input, { key: 'Tab', ctrlKey: true })).defaultPrevented).toBe(false)
    await key(h.input, { key: 'Tab' })
    // Tab again from the button moves on from the field.
    expect((await key(h.input, { key: 'Tab' })).defaultPrevented).toBe(false)
    await key(h.input, { key: 'ArrowDown' })
    expect(h.controller.selected.value?.id).toBe('history:other')
    expect((await key(h.input, { key: 'Tab' })).defaultPrevented).toBe(false)
    expect(h.controller.switchFocused.value).toBe(false)
  })

  it('offers no switch to the tab shown, Home or a blank tab', async () => {
    const h = createHarness({
      tabs: [tab('shown'), tab('home', 'hronaut://home/'), tab('blank', 'about:blank')],
      history: [visit('shown'), visit('home', 'hronaut://home/'), visit('blank', 'about:blank')]
    })
    await typeAddress(h.input, '')
    await waitFor(() => expect(h.lastShown()?.suggestions.length).toBeGreaterThan(0))
    expect(h.lastShown()!.suggestions.every(suggestion => suggestion.openTabId === undefined)).toBe(true)
    await typeAddress(h.input, '@tabs')
    await waitFor(() => expect(h.controller.suggestions.value).toEqual([]))
  })

  it('lists the open tabs with @tabs, and Enter or a click on one switches to it', async () => {
    const h = createHarness({ tabs: [tab('shown'), tab('one', 'https://app.example/one'), tab('two', 'https://app.example/two')], history: [] })
    await typeAddress(h.input, '@tabs app')
    await waitFor(() => expect(h.lastShown()?.suggestions.map(suggestion => [suggestion.id, suggestion.kind, suggestion.openTabId])).toEqual([
      ['tab:one', 'tab', 'one'], ['tab:two', 'tab', 'two']
    ]))
    // An open tab's row switches to it, so Tab has no button to go on to there.
    await key(h.input, { key: 'ArrowDown' })
    expect((await key(h.input, { key: 'Tab' })).defaultPrevented).toBe(false)
    await key(h.input, { key: 'Enter' })
    await waitFor(() => expect(h.onSwitchToTab).toHaveBeenLastCalledWith('one'))

    await typeAddress(h.input, '@tabs app')
    await waitFor(() => expect(h.controller.visible.value).toBe(true))
    h.pick('tab:two')
    await waitFor(() => expect(h.onSwitchToTab).toHaveBeenLastCalledWith('two'))
    // A middle-click opens its page in a new tab behind, as on any row.
    await typeAddress(h.input, '@tabs app')
    await waitFor(() => expect(h.controller.visible.value).toBe(true))
    h.pick('tab:two', { disposition: 'new-background-tab' })
    await waitFor(() => expect(h.onOpenInNewTab).toHaveBeenCalledExactlyOnceWith('https://app.example/two', true))
    expect(h.onSwitchToTab).toHaveBeenCalledTimes(2)
    expect(h.onNavigate).not.toHaveBeenCalled()
  })

  it('switches from a click on a row\'s Switch to this tab button, and opens the row from a click elsewhere on it', async () => {
    const h = createHarness({ tabs: [tab('shown'), tab('docs')], history: [visit('docs')] })
    await typeAddress(h.input, 'docs')
    await waitFor(() => expect(h.controller.visible.value).toBe(true))
    h.pick('history:docs', { action: 'switch-tab' })
    await waitFor(() => expect(h.onSwitchToTab).toHaveBeenCalledExactlyOnceWith('docs'))
    await typeAddress(h.input, 'docs')
    await waitFor(() => expect(h.controller.visible.value).toBe(true))
    h.pick('history:docs')
    await waitFor(() => expect(h.onNavigate).toHaveBeenCalledExactlyOnceWith('https://docs.example/'))
  })

  it('opens the page here when its tab closed meanwhile, as Chrome does', async () => {
    const h = createHarness({ tabs: [tab('shown'), tab('docs')], history: [visit('docs')] })
    await typeAddress(h.input, 'docs')
    await waitFor(() => expect(h.controller.visible.value).toBe(true))
    h.tabs.value = [tab('shown')]
    h.pick('history:docs', { action: 'switch-tab' })
    await waitFor(() => expect(h.onNavigate).toHaveBeenCalledExactlyOnceWith('https://docs.example/'))
    expect(h.onSwitchToTab).not.toHaveBeenCalled()
  })

  it('opens the page here from a click on the button that arrives after the view showed the row without its tab', async () => {
    const h = createHarness({ tabs: [tab('shown'), tab('docs')], history: [visit('docs')] })
    await typeAddress(h.input, 'docs')
    await waitFor(() => expect(h.lastShown()?.suggestions[0]?.openTabId).toBe('docs'))
    h.tabs.value = [tab('shown')]
    await waitFor(() => expect(h.lastShown()?.suggestions[0]).not.toHaveProperty('openTabId'))
    h.pick('history:docs', { action: 'switch-tab' })
    await waitFor(() => expect(h.onNavigate).toHaveBeenCalledExactlyOnceWith('https://docs.example/'))
    expect(h.onSwitchToTab).not.toHaveBeenCalled()
  })

  it('opens the page here when its tab could not be shown', async () => {
    const h = createHarness({ tabs: [tab('shown'), tab('docs')], history: [visit('docs')] })
    h.onSwitchToTab.mockResolvedValueOnce(false)
    await typeAddress(h.input, 'docs')
    await key(h.input, { key: 'ArrowDown' })
    await key(h.input, { key: 'Tab' })
    await key(h.input, { key: 'Enter' })
    await waitFor(() => expect(h.onNavigate).toHaveBeenCalledExactlyOnceWith('https://docs.example/'))
    expect(h.onSwitchToTab).toHaveBeenCalledExactlyOnceWith('docs')
  })

  it('lists a tab whose address is longer than the suggestions view shows, and keeps the whole address to open', async () => {
    const long = `data:text/plain,${'x'.repeat(ADDRESS_SUGGESTION_URL_MAX_LENGTH + 10)}`
    const h = createHarness({ tabs: [tab('shown'), tab('long', long, 'Long page')], history: [] })
    await typeAddress(h.input, '@tabs long')
    await waitFor(() => expect(h.lastShown()?.suggestions.map(suggestion => suggestion.id)).toEqual(['tab:long']))
    // The view gets as much of the address as it takes.
    expect(h.lastShown()!.suggestions[0].url).toBe(long.slice(0, ADDRESS_SUGGESTION_URL_MAX_LENGTH))
    expect(h.controller.suggestions.value[0].url).toBe(long)
    h.tabs.value = [tab('shown')]
    h.pick('tab:long')
    await waitFor(() => expect(h.onNavigate).toHaveBeenCalledExactlyOnceWith(long))
  })

  it('keeps the suggestions and the button as they are while other tabs load or change title, and updates them for a new address', async () => {
    const h = createHarness({ tabs: [tab('shown'), tab('docs'), tab('busy')], history: [visit('docs')] })
    await typeAddress(h.input, 'docs')
    await key(h.input, { key: 'ArrowDown' })
    await key(h.input, { key: 'Tab' })
    await waitFor(() => expect(h.lastShown()).toMatchObject({ selectedAction: 'switch-tab' }))
    const shows = h.overlay.show.mock.calls.length
    // The browser state another tab's loading brings.
    h.tabs.value = h.tabs.value.map(candidate => candidate.id === 'busy' ? { ...candidate, loading: true } : { ...candidate })
    await nextTick()
    await nextTick()
    expect(h.overlay.show.mock.calls.length).toBe(shows)
    // Another tab's new title cannot change these rows either.
    h.tabs.value = h.tabs.value.map(candidate => candidate.id === 'busy' ? { ...candidate, title: 'Busy page' } : candidate)
    await nextTick()
    await nextTick()
    expect(h.overlay.show.mock.calls.length).toBe(shows)
    // Another tab's new address draws them again, with the button still where Tab put it.
    h.tabs.value = h.tabs.value.map(candidate => candidate.id === 'busy' ? { ...candidate, url: 'https://busy.example/next' } : candidate)
    await waitFor(() => expect(h.overlay.show.mock.calls.length).toBeGreaterThan(shows))
    expect(h.lastShown()).toMatchObject({ selectedIndex: 0, selectedAction: 'switch-tab' })
    // Its tab leaving takes the button with it.
    h.tabs.value = h.tabs.value.filter(candidate => candidate.id !== 'docs')
    await waitFor(() => expect(h.lastShown()?.suggestions[0]).not.toHaveProperty('openTabId'))
    expect(h.controller.switchFocused.value).toBe(false)
    expect(h.lastShown()).not.toHaveProperty('selectedAction')
  })

  it('draws @tabs again for an open tab\'s new title', async () => {
    const h = createHarness({ tabs: [tab('shown'), tab('one', 'https://app.example/one')], history: [] })
    await typeAddress(h.input, '@tabs')
    await waitFor(() => expect(h.lastShown()?.suggestions.map(suggestion => suggestion.title)).toEqual(['Page one']))
    h.tabs.value = h.tabs.value.map(candidate => candidate.id === 'one' ? { ...candidate, title: 'Renamed' } : candidate)
    await waitFor(() => expect(h.lastShown()?.suggestions.map(suggestion => suggestion.title)).toEqual(['Renamed']))
  })
})
