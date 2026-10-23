import { createEvent, fireEvent, render, screen } from '@testing-library/vue'
import { computed, defineComponent, nextTick, ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { useAddressBarController } from '../../src/renderer/src/composables/useAddressBarController.js'
import type { BrowserHistoryEntry, BrowserTabState } from '../../src/shared/types.js'

// A paste into the address field went in as copied, so `javascript:` text copied from a page, pasted and entered, ran
// as script in the tab; Chrome's address bar drops the scheme from every paste and drop.

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
        <input ref="input" v-model="address" aria-label="Address" @focus="handleFocus" @input="handleInput" @paste="handlePaste" @dragstart="handleDragStart" @dragend="handleDragEnd" @drop="handleDrop" @keydown="handleKeydown" />
      </form>
      <button>Page</button>
    `
  })
  render(Harness)
  return { controller, onNavigate, onOpenInNewTab, input: screen.getByRole<HTMLInputElement>('textbox', { name: 'Address' }) }
}

// Whether the field was left to take the text itself, as it does when nothing prevents the event.
function paste(input: HTMLInputElement, text: string): boolean {
  const event = createEvent.paste(input, { clipboardData: { getData: (type: string) => type === 'text/plain' ? text : '' } })
  input.dispatchEvent(event)
  return !event.defaultPrevented
}

function drop(input: HTMLInputElement, text: string): boolean {
  const event = createEvent.drop(input, { dataTransfer: { getData: (type: string) => type === 'text/plain' ? text : '' } })
  input.dispatchEvent(event)
  return !event.defaultPrevented
}

describe('pasting into the address field', () => {
  it('drops a leading javascript: scheme and joins an address split over lines, at the selection', async () => {
    const rendered = createHarness()
    rendered.input.focus()
    await fireEvent.focus(rendered.input)
    // The field shows the tab's address, untouched, and the paste replaces its last part.
    expect(rendered.input.value).toBe('https://example.test/first')
    expect(rendered.controller.dirty.value).toBe(false)
    rendered.input.setSelectionRange('https://example.test/'.length, rendered.input.value.length)

    expect(paste(rendered.input, 'javascript:alert(document.cookie)')).toBe(false)
    await nextTick()
    expect(rendered.input.value).toBe('https://example.test/alert(document.cookie)')
    expect(rendered.controller.address.value).toBe('https://example.test/alert(document.cookie)')
    expect(rendered.input.selectionStart).toBe('https://example.test/alert(document.cookie)'.length)
    expect(rendered.controller.dirty.value).toBe(true)

    rendered.input.select()
    expect(paste(rendered.input, '  https://example.com/a\n  /b  ')).toBe(false)
    await nextTick()
    expect(rendered.controller.address.value).toBe('https://example.com/a/b')
  })

  it('leaves a paste that needs nothing dropped to the field, and pastes nothing for only a scheme', async () => {
    const rendered = createHarness()
    rendered.input.focus()
    await fireEvent.update(rendered.input, 'kept')
    // The field pastes clean text itself, keeping its own undo.
    expect(paste(rendered.input, 'example.com/docs')).toBe(true)
    expect(paste(rendered.input, '')).toBe(true)
    expect(paste(rendered.input, 'javascript:')).toBe(false)
    expect(paste(rendered.input, ' \n ')).toBe(false)
    await nextTick()
    expect(rendered.controller.address.value).toBe('kept')
    expect(rendered.onNavigate).not.toHaveBeenCalled()
  })
})

describe('dropping text on the address field', () => {
  it('replaces the field\'s text with dropped text that needs a javascript: dropped, as Chrome does', async () => {
    const rendered = createHarness()
    expect(rendered.controller.dirty.value).toBe(false)

    expect(drop(rendered.input, 'javascript:alert(1)')).toBe(false)
    await nextTick()
    expect(rendered.input.value).toBe('alert(1)')
    expect(rendered.controller.dirty.value).toBe(true)

    expect(drop(rendered.input, 'java\nscript:')).toBe(false)
    await nextTick()
    expect(rendered.input.value).toBe('alert(1)')
    expect(rendered.onNavigate).not.toHaveBeenCalled()
  })

  // The field said it was focused and kept its suggestions open while the keyboard stayed where the text came from, so
  // Enter went to the page and no focus change ever closed the suggestions.
  it('gives the field the keyboard with the dropped text selected, as Chrome does', async () => {
    const rendered = createHarness()
    const page = screen.getByRole('button', { name: 'Page' })
    page.focus()

    expect(drop(rendered.input, 'javascript:alert(1)')).toBe(false)
    await nextTick()
    expect(document.activeElement).toBe(rendered.input)
    expect([rendered.input.selectionStart, rendered.input.selectionEnd]).toEqual([0, 'alert(1)'.length])
    expect(rendered.controller.focused.value).toBe(true)
  })

  it('leaves clean text, an empty drop and text dragged within the field to the field itself', async () => {
    const rendered = createHarness()
    expect(drop(rendered.input, 'hronaut.dev')).toBe(true)
    expect(drop(rendered.input, '')).toBe(true)

    // Moving the field's own selected text, even text that reads as script, is the field's move, not a paste.
    await fireEvent.update(rendered.input, 'go javascript:void(0)')
    await fireEvent.dragStart(rendered.input)
    expect(drop(rendered.input, 'javascript:void(0)')).toBe(true)
    await fireEvent.dragEnd(rendered.input)
    expect(rendered.input.value).toBe('go javascript:void(0)')
    // Once that drag has ended, text from elsewhere is read as a paste again.
    expect(drop(rendered.input, 'javascript:void(0)')).toBe(false)
    await nextTick()
    expect(rendered.input.value).toBe('void(0)')
  })
})
