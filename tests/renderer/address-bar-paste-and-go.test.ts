import { fireEvent, render, screen } from '@testing-library/vue'
import { computed, defineComponent, nextTick, ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { useAddressBarController } from '../../src/renderer/src/composables/useAddressBarController.js'
import type { BrowserHistoryEntry, BrowserTabState } from '../../src/shared/types.js'

// Paste and Go in the address field's native menu sends the clipboard text here, to open as Enter would.

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
  let finishNavigation = (): void => undefined
  const onNavigate = vi.fn((_address: string) => new Promise<void>((resolve) => { finishNavigation = resolve }))
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
  return { controller, activeTab, onNavigate, finishNavigation: () => finishNavigation(), input: screen.getByRole<HTMLInputElement>('textbox', { name: 'Address' }) }
}

describe('Paste and Go in the address field', () => {
  it('shows the pasted text in the field and opens it in the current tab, as Enter does', async () => {
    const rendered = createHarness()
    rendered.input.focus()
    await fireEvent.focus(rendered.input)
    await fireEvent.update(rendered.input, 'half-typed')

    const navigation = rendered.controller.pasteAndGo('example.com/docs')
    await nextTick()
    expect(rendered.onNavigate).toHaveBeenCalledExactlyOnceWith('example.com/docs')
    expect(rendered.input.value).toBe('example.com/docs')
    expect(document.activeElement).not.toBe(rendered.input)
    expect(rendered.controller.visible.value).toBe(false)

    // The tab's own address comes back once the navigation settles, as after Enter.
    rendered.activeTab.value = { ...rendered.activeTab.value, url: 'https://example.com/docs' }
    rendered.finishNavigation()
    await navigation
    await nextTick()
    expect(rendered.input.value).toBe('https://example.com/docs')
    expect(rendered.controller.dirty.value).toBe(false)
  })

  it('opens nothing for blank text or once the field has gone', async () => {
    const rendered = createHarness()
    await rendered.controller.pasteAndGo('   ')
    rendered.controller.dispose()
    await rendered.controller.pasteAndGo('example.com')
    expect(rendered.onNavigate).not.toHaveBeenCalled()
  })
})
