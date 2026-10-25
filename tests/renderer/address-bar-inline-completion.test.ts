import { render, screen, waitFor } from '@testing-library/vue'
import { computed, defineComponent, nextTick, ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useAddressBarController } from '../../src/renderer/src/composables/useAddressBarController.js'
import type { AddressSuggestionOverlayRequest, AddressSuggestionSelection } from '../../src/shared/address-suggestions.js'
import type { BrowserBookmark, BrowserHistoryEntry, BrowserTabState } from '../../src/shared/types.js'

// The address bar left what was typed as it was, so "github" and Enter searched for it even with github.com in the
// history. Chrome fills in the rest of the site after the typed text, selected, and Enter opens it.

const shownTab: BrowserTabState = {
  id: 'shown',
  title: 'Shown page',
  url: 'https://shown.test/',
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

// Chrome fills in only what was typed before; a site here needs two visits.
function visit(id: string, url: string, visitCount = 2): BrowserHistoryEntry {
  return { id, title: `Visit ${id}`, url, visitedAt: '2026-10-25T00:00:00.000Z', visitCount }
}

function createHarness(entries: BrowserHistoryEntry[], bookmarks: BrowserBookmark[] = []) {
  const history = ref(entries)
  const active = ref(shownTab)
  const onNavigate = vi.fn(async (_address: string) => undefined)
  const onOpenInNewTab = vi.fn(async (_address: string, _background: boolean) => undefined)
  const onRemoveVisit = vi.fn(async (_entryId: string) => undefined)
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
        activeTab: computed(() => active.value),
        tabs: computed(() => [active.value]),
        bookmarks: ref(bookmarks),
        history,
        overlay,
        theme: () => 'dark',
        locale: () => 'en-US',
        translate: (key) => key,
        formatNumber: String,
        onOpen: vi.fn(),
        onNavigate,
        onOpenInNewTab,
        onSwitchToTab: vi.fn(async () => true),
        onRemoveVisit,
        onRemoveVisitFailed: vi.fn(),
        onFocusLeft: vi.fn()
      })
      return controller
    },
    template: `
      <form ref="form" @submit.prevent="submit" @focusout="handleFocusOut">
        <input ref="input" v-model="address" aria-label="Address" @focus="handleFocus" @input="handleInput" @paste="handlePaste" @keydown="handleKeydown" />
      </form>
    `
  })
  render(Harness)
  const input = screen.getByRole<HTMLInputElement>('textbox', { name: 'Address' })
  return {
    controller,
    history,
    active,
    overlay,
    onNavigate,
    onOpenInNewTab,
    onRemoveVisit,
    input,
    field: () => ({ value: input.value, selected: input.value.slice(input.selectionStart ?? 0, input.selectionEnd ?? 0) }),
    pick: (suggestionId: string) => selectedListener?.({ sessionId: overlay.show.mock.calls.at(-1)![0].sessionId, suggestionId })
  }
}

// What a key press or other edit does to the field: the selected text gives way to it, and the field reports the input.
async function edit(input: HTMLInputElement, text: string, inputType = 'insertText', init: InputEventInit = {}): Promise<void> {
  if (document.activeElement !== input) input.focus()
  let start = input.selectionStart ?? input.value.length
  let end = input.selectionEnd ?? input.value.length
  // Backspace and Delete take the selected text, or else the character before or after the caret.
  if (start === end && inputType === 'deleteContentBackward') start = Math.max(0, start - 1)
  if (start === end && inputType === 'deleteContentForward') end = Math.min(input.value.length, end + 1)
  input.setRangeText(text, start, end, 'end')
  input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType, data: text || null, ...init }))
  await nextTick()
}

async function type(input: HTMLInputElement, text: string): Promise<void> {
  for (const character of text) await edit(input, character)
}

async function clear(input: HTMLInputElement): Promise<void> {
  input.focus()
  input.select()
  await edit(input, '', 'deleteContentBackward')
}

async function key(input: HTMLInputElement, init: KeyboardEventInit): Promise<KeyboardEvent> {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
  input.dispatchEvent(event)
  await nextTick()
  await nextTick()
  return event
}

describe('inline completion in the address bar', () => {
  it('fills in the rest of a visited site after the typed text, selected, and Enter opens the site', async () => {
    const h = createHarness([visit('repo', 'https://github.com/hronaut/hronaut', 3), visit('other', 'https://example.com/')])
    // The field shows the page's address until it is cleared, as when the person selects it and starts typing.
    await clear(h.input)
    await type(h.input, 'gi')
    expect(h.field()).toEqual({ value: 'github.com', selected: 'thub.com' })
    // The suggestions are the typed text's.
    await waitFor(() => expect(h.overlay.show).toHaveBeenCalled())
    expect(h.controller.suggestions.value.map(suggestion => suggestion.id)).toEqual(['history:repo'])
    await h.controller.submit()
    expect(h.onNavigate).toHaveBeenCalledExactlyOnceWith('https://github.com/')
  })

  it('keeps a local server\'s port and http, and fills in a page once the typed text reaches its path', async () => {
    const h = createHarness([visit('app', 'http://localhost:5173/app/settings')])
    await clear(h.input)
    await type(h.input, 'loc')
    expect(h.field()).toEqual({ value: 'localhost:5173', selected: 'alhost:5173' })
    await type(h.input, 'alhost:5173/a')
    expect(h.field()).toEqual({ value: 'localhost:5173/app/settings', selected: 'pp/settings' })
    await h.controller.submit()
    expect(h.onNavigate).toHaveBeenCalledExactlyOnceWith('http://localhost:5173/app/settings')
  })

  it('takes typing on over the rest, and Backspace or Delete takes the rest away', async () => {
    const h = createHarness([visit('repo', 'https://github.com/')])
    await clear(h.input)
    await type(h.input, 'gi')
    await edit(h.input, 'x')
    expect(h.field()).toEqual({ value: 'gix', selected: '' })
    await edit(h.input, '', 'deleteContentBackward')
    expect(h.field()).toEqual({ value: 'gi', selected: '' })
    await type(h.input, 't')
    expect(h.field()).toEqual({ value: 'github.com', selected: 'hub.com' })
    await edit(h.input, '', 'deleteContentForward')
    expect(h.field()).toEqual({ value: 'git', selected: '' })
    // What is left is a search, and opens as typed.
    await h.controller.submit()
    expect(h.onNavigate).toHaveBeenCalledExactlyOnceWith('git')
  })

  it('leaves pasted text, text being composed and typing inside the field as they are', async () => {
    const h = createHarness([visit('repo', 'https://github.com/')])
    await clear(h.input)
    await edit(h.input, 'gi', 'insertFromPaste')
    expect(h.field().value).toBe('gi')
    await edit(h.input, '', 'deleteContentBackward')
    await edit(h.input, '', 'deleteContentBackward')
    await edit(h.input, 'g', 'insertCompositionText', { isComposing: true })
    expect(h.field().value).toBe('g')
    h.input.value = 'ub'
    h.input.setSelectionRange(0, 0)
    await edit(h.input, 'g')
    expect(h.field()).toEqual({ value: 'gub', selected: '' })
  })

  it('goes back to the typed text when the highlight moves to a row, where Enter opens the row', async () => {
    const h = createHarness([visit('repo', 'https://github.com/hronaut/hronaut'), visit('docs', 'https://docs.github.com/en')])
    await clear(h.input)
    await type(h.input, 'gi')
    expect(h.field().value).toBe('github.com')
    await key(h.input, { key: 'ArrowDown' })
    expect(h.field()).toEqual({ value: 'gi', selected: '' })
    expect(h.controller.selected.value?.id).toBe('history:repo')
    await key(h.input, { key: 'Enter' })
    await waitFor(() => expect(h.onNavigate).toHaveBeenCalledExactlyOnceWith('https://github.com/hronaut/hronaut'))
  })

  it('adds www. and .com to the typed text with Ctrl+Enter, and opens the site in a new tab with Alt+Enter', async () => {
    const h = createHarness([visit('repo', 'https://github.com/')])
    await clear(h.input)
    await type(h.input, 'github')
    expect(h.field()).toEqual({ value: 'github.com', selected: '.com' })
    await key(h.input, { key: 'Enter', ctrlKey: true })
    expect(h.onNavigate).toHaveBeenCalledExactlyOnceWith('www.github.com')
    await clear(h.input)
    await type(h.input, 'gith')
    await key(h.input, { key: 'Enter', altKey: true })
    await waitFor(() => expect(h.onOpenInNewTab).toHaveBeenCalledExactlyOnceWith('https://github.com/', false))
  })

  it('takes the rest away when its visit leaves the history, and Escape gives the field its page\'s address back', async () => {
    const h = createHarness([visit('repo', 'https://github.com/')])
    await clear(h.input)
    await type(h.input, 'gi')
    expect(h.field().value).toBe('github.com')
    h.history.value = []
    await nextTick()
    expect(h.field()).toEqual({ value: 'gi', selected: '' })
    h.history.value = [visit('repo', 'https://github.com/')]
    await type(h.input, 't')
    expect(h.field().value).toBe('github.com')
    await key(h.input, { key: 'Escape' })
    expect(h.field().value).toBe('https://shown.test/')
    await h.controller.submit()
    expect(h.onNavigate).toHaveBeenCalledExactlyOnceWith('https://shown.test/')
  })

  it('forgets the visit the rest came from with Shift+Delete when nothing is highlighted, and leaves a bookmark\'s rest instead of cutting it', async () => {
    const h = createHarness([visit('repo', 'https://github.com/')], [{ id: 'docs', title: 'Docs', url: 'https://docs.example/guide', createdAt: '2026-10-25T00:00:00.000Z', updatedAt: '2026-10-25T00:00:00.000Z' }])
    await clear(h.input)
    await type(h.input, 'gi')
    expect(h.field().value).toBe('github.com')
    const forget = await key(h.input, { key: 'Delete', shiftKey: true })
    expect(forget.defaultPrevented).toBe(true)
    expect(h.onRemoveVisit).toHaveBeenCalledExactlyOnceWith('repo')
    expect(h.field()).toEqual({ value: 'gi', selected: '' })
    await clear(h.input)
    await type(h.input, 'do')
    expect(h.field()).toEqual({ value: 'docs.example', selected: 'cs.example' })
    const bookmarkKey = await key(h.input, { key: 'Delete', shiftKey: true })
    expect(bookmarkKey.defaultPrevented).toBe(true)
    expect(h.field()).toEqual({ value: 'do', selected: '' })
    expect(h.onRemoveVisit).toHaveBeenCalledOnce()
  })

  it('keeps the suggestions on the typed text while an input method composes over the rest', async () => {
    const h = createHarness([visit('repo', 'https://github.com/'), visit('glass', 'https://glass.example/')])
    await clear(h.input)
    await type(h.input, 'g')
    expect(h.field().value).toBe('github.com')
    const before = h.controller.suggestions.value.map(suggestion => suggestion.id)
    h.input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
    await edit(h.input, '\u3042', 'insertCompositionText', { isComposing: true })
    expect(h.input.value).toBe('g\u3042')
    expect(h.controller.suggestions.value.map(suggestion => suggestion.id)).toEqual(before)
    h.input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }))
    await nextTick()
    expect(h.controller.address.value).toBe('g\u3042')
  })

  it('takes the rest away for another tab\'s address, and keeps it as text when the field is left', async () => {
    const h = createHarness([visit('repo', 'https://github.com/'), visit('page', 'https://github.com/hronaut')])
    await clear(h.input)
    await type(h.input, 'gi')
    h.active.value = { ...shownTab, id: 'other', url: 'https://other.test/' }
    await nextTick()
    expect(h.field().value).toBe('https://other.test/')
    // Even a tab whose address is the very text the field filled in shows only its address, so Shift+Delete there
    // forgets nothing.
    await clear(h.input)
    await type(h.input, 'https://github.com/h')
    expect(h.field()).toEqual({ value: 'https://github.com/hronaut', selected: 'ronaut' })
    h.active.value = { ...shownTab, id: 'third', url: 'https://github.com/hronaut' }
    await nextTick()
    const forget = await key(h.input, { key: 'Delete', shiftKey: true })
    expect(forget.defaultPrevented).toBe(false)
    expect(h.onRemoveVisit).not.toHaveBeenCalled()
    await clear(h.input)
    await type(h.input, 'gi')
    h.input.blur()
    await new Promise(resolve => setTimeout(resolve, 0))
    h.input.focus()
    await nextTick()
    expect(h.field().value).toBe('github.com')
    await h.controller.submit()
    expect(h.onNavigate).toHaveBeenCalledExactlyOnceWith('github.com')
  })

  it('opens the site in a new tab behind with Alt+Shift+Enter, and a click on a row opens the row', async () => {
    const h = createHarness([visit('repo', 'https://github.com/hronaut/hronaut')])
    await clear(h.input)
    await type(h.input, 'gi')
    await key(h.input, { key: 'Enter', altKey: true, shiftKey: true })
    await waitFor(() => expect(h.onOpenInNewTab).toHaveBeenCalledExactlyOnceWith('https://github.com/', true))
    expect(h.field().value).toBe('github.com')
    await waitFor(() => expect(h.overlay.show).toHaveBeenCalled())
    h.pick('history:repo')
    await waitFor(() => expect(h.onNavigate).toHaveBeenCalledExactlyOnceWith('https://github.com/hronaut/hronaut'))
  })

  it('keeps a completion that another row still gives when its own row leaves, and takes it away once the site has one visit', async () => {
    const h = createHarness([visit('a', 'https://github.com/a'), visit('b', 'https://github.com/b')])
    await clear(h.input)
    await type(h.input, 'gi')
    expect(h.field().value).toBe('github.com')
    h.history.value = [visit('b', 'https://github.com/b')]
    await nextTick()
    expect(h.field()).toEqual({ value: 'github.com', selected: 'thub.com' })
    h.history.value = [visit('b', 'https://github.com/b', 1)]
    await nextTick()
    expect(h.field()).toEqual({ value: 'gi', selected: '' })
  })

  describe('with the browser\'s editing commands', () => {
    const original = Object.getOwnPropertyDescriptor(document, 'execCommand')
    afterEach(() => {
      if (original) Object.defineProperty(document, 'execCommand', original)
      else delete (document as { execCommand?: unknown }).execCommand
    })

    // As Chromium does, insertText edits the focused field and reports the edit as input at once.
    function stubInsertText() {
      const execCommand = vi.fn((command: string, _ui?: boolean, value?: string) => {
        const field = document.activeElement
        if (command !== 'insertText' || !(field instanceof HTMLInputElement) || value === undefined) return false
        field.setRangeText(value, field.selectionStart ?? field.value.length, field.selectionEnd ?? field.value.length, 'end')
        field.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }))
        return true
      })
      Object.defineProperty(document, 'execCommand', { configurable: true, value: execCommand })
      return execCommand
    }

    it('fills in the rest through the field\'s own editing, which is not typed text', async () => {
      const h = createHarness([visit('repo', 'https://github.com/'), visit('lab', 'https://gitlab.com/', 1)])
      await clear(h.input)
      const execCommand = stubInsertText()
      await type(h.input, 'gi')
      expect(execCommand).toHaveBeenLastCalledWith('insertText', false, 'thub.com')
      expect(h.field()).toEqual({ value: 'github.com', selected: 'thub.com' })
      // The suggestions stay the typed text's.
      expect(h.controller.suggestions.value.map(suggestion => suggestion.id).sort()).toEqual(['history:lab', 'history:repo'])
      await h.controller.submit()
      expect(h.onNavigate).toHaveBeenCalledExactlyOnceWith('https://github.com/')
    })

    it('leaves a cleaned-up paste as pasted', async () => {
      const h = createHarness([visit('repo', 'https://github.com/')])
      await clear(h.input)
      const execCommand = stubInsertText()
      const paste = new Event('paste', { bubbles: true, cancelable: true })
      Object.defineProperty(paste, 'clipboardData', { value: { getData: () => 'git\nhub' } })
      h.input.dispatchEvent(paste)
      await nextTick()
      expect(execCommand).toHaveBeenCalledExactlyOnceWith('insertText', false, 'github')
      expect(h.field()).toEqual({ value: 'github', selected: '' })
    })
  })
})
