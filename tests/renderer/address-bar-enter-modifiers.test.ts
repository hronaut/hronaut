import { fireEvent, render, screen } from '@testing-library/vue'
import { computed, defineComponent, ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { addressEnterAction, withWwwAndCom } from '../../src/renderer/src/address-enter.js'
import { useAddressBarController } from '../../src/renderer/src/composables/useAddressBarController.js'
import type { BrowserHistoryEntry, BrowserTabState } from '../../src/shared/types.js'

const shellWindow = window as unknown as { hronautShell?: { windowChrome: { platform: string } } }

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

function createHarness(history: BrowserHistoryEntry[] = []) {
  const activeTab = ref(tab('first'))
  const onNavigate = vi.fn(async (_address: string) => undefined)
  const onOpenInNewTab = vi.fn(async (_address: string, _background: boolean) => undefined)
  let controller!: ReturnType<typeof useAddressBarController>
  const Harness = defineComponent({
    setup() {
      controller = useAddressBarController({
        activeTab: computed(() => activeTab.value),
        bookmarks: ref([]),
        history: ref(history),
        theme: () => 'dark',
        locale: () => 'en-US',
        translate: (key) => key,
        formatNumber: String,
        onOpen: vi.fn(),
        onNavigate,
        onOpenInNewTab,
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
  return { controller, onNavigate, onOpenInNewTab, input: screen.getByRole<HTMLInputElement>('textbox', { name: 'Address' }) }
}

async function typeAddress(input: HTMLInputElement, text: string): Promise<void> {
  input.focus()
  await fireEvent.focus(input)
  await fireEvent.update(input, text)
}

function keydown(input: HTMLInputElement, init: KeyboardEventInit): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, ...init })
  input.dispatchEvent(event)
  return event
}

afterEach(() => {
  delete shellWindow.hronautShell
})

describe('Enter with modifier keys in the address field', () => {
  it('maps the modifier keys by Chrome\'s rules on each platform', () => {
    const enter = (init: KeyboardEventInit, mac: boolean) => addressEnterAction(new KeyboardEvent('keydown', { key: 'Enter', ...init }), mac)
    for (const mac of [false, true]) {
      expect(enter({}, mac)).toBeUndefined()
      expect(enter({ ctrlKey: true }, mac)).toBe('add-www-and-com')
      expect(enter({ altKey: true }, mac)).toBe('new-tab')
      expect(enter({ altKey: true, shiftKey: true }, mac)).toBe('new-background-tab')
      // AltGr arrives as Ctrl and Alt together, and Shift+Enter opens a new window in Chrome, which Hronaut has not.
      expect(enter({ ctrlKey: true, altKey: true }, mac)).toBeUndefined()
      expect(enter({ shiftKey: true }, mac)).toBeUndefined()
      expect(enter({ ctrlKey: true, shiftKey: true }, mac)).toBeUndefined()
      expect(enter({ ctrlKey: true, metaKey: true }, mac)).toBeUndefined()
    }
    expect(enter({ metaKey: true }, true)).toBe('new-background-tab')
    expect(enter({ metaKey: true, shiftKey: true }, true)).toBe('new-tab')
    expect(enter({ metaKey: true, altKey: true }, true)).toBe('new-tab')
    expect(enter({ metaKey: true, altKey: true, shiftKey: true }, true)).toBe('new-tab')
    // The Windows or Super key does nothing special outside a Mac.
    expect(enter({ metaKey: true }, false)).toBeUndefined()
    expect(enter({ metaKey: true, altKey: true }, false)).toBeUndefined()
    expect(addressEnterAction(new KeyboardEvent('keydown', { key: 'a', ctrlKey: true }), false)).toBeUndefined()
  })

  it('adds www. and .com only to a bare site name', () => {
    expect(withWwwAndCom('example')).toBe('www.example.com')
    expect(withWwwAndCom('  Example  ')).toBe('www.Example.com')
    expect(withWwwAndCom('www.example')).toBe('www.example.com')
    expect(withWwwAndCom('my-site/news?page=2#top')).toBe('www.my-site.com/news?page=2#top')
    expect(withWwwAndCom('пример')).toBe('www.пример.com')
    // Names in scripts with combining marks are site names too.
    expect(withWwwAndCom('हिन्दी')).toBe('www.हिन्दी.com')
    for (const text of ['', '   ', 'two words', 'example.org', 'https://example', 'example:8080', 'user@example', '-example', 'example-', 'exa_mple', '/path']) {
      expect(withWwwAndCom(text), text).toBeUndefined()
    }
  })

  it('opens a site name with www. and .com in the current tab on Ctrl+Enter, and other text as typed', async () => {
    const rendered = createHarness()
    await typeAddress(rendered.input, 'example/news')
    const event = keydown(rendered.input, { ctrlKey: true })
    expect(event.defaultPrevented).toBe(true)
    expect(rendered.onNavigate).toHaveBeenLastCalledWith('www.example.com/news')

    await typeAddress(rendered.input, 'example.org')
    keydown(rendered.input, { ctrlKey: true })
    expect(rendered.onNavigate).toHaveBeenLastCalledWith('example.org')

    await typeAddress(rendered.input, '   ')
    expect(keydown(rendered.input, { ctrlKey: true }).defaultPrevented).toBe(true)
    expect(rendered.onNavigate).toHaveBeenCalledTimes(2)
    expect(rendered.onOpenInNewTab).not.toHaveBeenCalled()
  })

  it('opens the typed address in a new tab on Alt+Enter and shows the current tab\'s address again', async () => {
    const rendered = createHarness()
    await typeAddress(rendered.input, 'news.example')
    const event = keydown(rendered.input, { altKey: true })
    expect(event.defaultPrevented).toBe(true)
    expect(rendered.onOpenInNewTab).toHaveBeenCalledWith('news.example', false)
    expect(rendered.onNavigate).not.toHaveBeenCalled()
    expect(rendered.controller.address.value).toBe('https://example.test/first')
    expect(rendered.controller.dirty.value).toBe(false)
    expect(rendered.controller.open.value).toBe(false)
    expect(document.activeElement).not.toBe(rendered.input)
  })

  it('opens the picked suggestion in a new tab, and Ctrl+Enter opens a picked suggestion as Enter does', async () => {
    const entry: BrowserHistoryEntry = { id: 'docs', title: 'Docs', url: 'https://docs.example/', visitedAt: '2026-10-22T00:00:00.000Z', visitCount: 1 }
    const rendered = createHarness([entry])
    await typeAddress(rendered.input, 'docs')
    await fireEvent.keyDown(rendered.input, { key: 'ArrowDown' })
    expect(rendered.controller.selected.value?.url).toBe(entry.url)
    keydown(rendered.input, { altKey: true })
    expect(rendered.onOpenInNewTab).toHaveBeenCalledWith(entry.url, false)

    await typeAddress(rendered.input, 'docs')
    await fireEvent.keyDown(rendered.input, { key: 'ArrowDown' })
    expect(keydown(rendered.input, { ctrlKey: true }).defaultPrevented).toBe(true)
    expect(rendered.onNavigate).toHaveBeenCalledWith(entry.url)
  })

  it('opens a new background tab on ⌘+Return on a Mac and keeps the typed text, and ⌘+Shift+Return opens it in front', async () => {
    shellWindow.hronautShell = { windowChrome: { platform: 'darwin' } }
    const rendered = createHarness()
    await typeAddress(rendered.input, 'later.example')
    expect(keydown(rendered.input, { metaKey: true }).defaultPrevented).toBe(true)
    expect(rendered.onOpenInNewTab).toHaveBeenLastCalledWith('later.example', true)
    expect(rendered.controller.address.value).toBe('later.example')
    expect(document.activeElement).toBe(rendered.input)

    // Holding the keys opens one tab, not one for each repeat.
    expect(keydown(rendered.input, { metaKey: true, repeat: true }).defaultPrevented).toBe(true)
    expect(rendered.onOpenInNewTab).toHaveBeenCalledTimes(1)

    keydown(rendered.input, { metaKey: true, shiftKey: true })
    expect(rendered.onOpenInNewTab).toHaveBeenLastCalledWith('later.example', false)
    expect(rendered.onNavigate).not.toHaveBeenCalled()
  })

  it('opens a new background tab on Alt+Shift+Enter and keeps the typed text and its suggestions', async () => {
    const rendered = createHarness()
    await typeAddress(rendered.input, 'later.example')
    expect(rendered.controller.open.value).toBe(true)
    expect(keydown(rendered.input, { altKey: true, shiftKey: true }).defaultPrevented).toBe(true)
    expect(rendered.onOpenInNewTab).toHaveBeenCalledWith('later.example', true)
    expect(rendered.controller.address.value).toBe('later.example')
    expect(document.activeElement).toBe(rendered.input)
    // As in Chrome, the suggestions stay open to open another one behind.
    expect(rendered.controller.open.value).toBe(true)
    expect(rendered.onNavigate).not.toHaveBeenCalled()
  })

  it('leaves Enter with other keys to the field, and opens nothing for an empty field', async () => {
    const rendered = createHarness()
    await typeAddress(rendered.input, 'example')
    expect(keydown(rendered.input, { metaKey: true }).defaultPrevented).toBe(false)
    expect(keydown(rendered.input, { ctrlKey: true, shiftKey: true }).defaultPrevented).toBe(false)
    expect(keydown(rendered.input, { isComposing: true, altKey: true }).defaultPrevented).toBe(false)

    await typeAddress(rendered.input, '')
    expect(keydown(rendered.input, { altKey: true }).defaultPrevented).toBe(true)
    expect(rendered.onOpenInNewTab).not.toHaveBeenCalled()
    expect(rendered.onNavigate).not.toHaveBeenCalled()
  })
})
