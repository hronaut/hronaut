import { fireEvent, render, screen } from '@testing-library/vue'
import { computed, defineComponent, nextTick, ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { useAddressBarController } from '../../src/renderer/src/features/address-bar/useAddressBarController.js'
import type { BrowserTabState } from '../../src/shared/types.js'

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

// Coming back to a tab whose address field had the keyboard, the field takes it back as Chrome's does: with the text
// and selection it had, and no suggestions until the person types.
describe('the address field taking the keyboard back', () => {
  function mountField() {
    const first = tab('first')
    const second = tab('second')
    const activeTab = ref(first)
    const tabs = ref([first, second])
    const onOpen = vi.fn()
    let controller!: ReturnType<typeof useAddressBarController>
    const view = render(defineComponent({
      setup() {
        controller = useAddressBarController({
          activeTab: computed(() => activeTab.value),
          tabs,
          bookmarks: ref([{ id: 'saved', url: 'https://saved.example/', title: 'Saved page', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }]),
          history: ref([]),
          theme: () => 'dark',
          locale: () => 'en-US',
          translate: (key) => key,
          formatNumber: String,
          onOpen,
          onNavigate: vi.fn(async () => undefined),
          onOpenInNewTab: vi.fn(async () => undefined),
          onSwitchToTab: vi.fn(async () => true),
          onRemoveVisit: vi.fn(async () => undefined),
          onRemoveVisitFailed: vi.fn(),
          onFocusLeft: vi.fn()
        })
        return controller
      },
      template: `
        <form @focusout="handleFocusOut">
          <input ref="input" v-model="address" aria-label="Address" @focus="handleFocus" @input="handleInput" />
        </form>
        <button type="button">Elsewhere</button>
      `
    }))
    const field = screen.getByLabelText<HTMLInputElement>('Address')
    const show = async (shown: BrowserTabState) => {
      activeTab.value = shown
      await nextTick()
      await nextTick()
    }
    /** The page takes the keyboard, as main gives it to the tab shown. */
    const pageTakesKeyboard = async () => {
      field.blur()
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
    return { view, controller, field, show, pageTakesKeyboard, onOpen, activeTab, first, second }
  }

  it('gives it back with the text and selection it had, opening no suggestions', async () => {
    const { view, controller, field, show, pageTakesKeyboard, onOpen, first, second } = mountField()
    try {
      field.focus()
      await fireEvent.update(field, 'page')
      await nextTick()
      expect(controller.open.value).toBe(true)
      field.setSelectionRange(1, 3)
      await show(second)
      await pageTakesKeyboard()
      expect(field.value).toBe(second.url)
      onOpen.mockClear()

      await show(first)
      expect(controller.returnFocus('first')).toBe(true)
      expect(document.activeElement).toBe(field)
      expect(field.value).toBe('page')
      expect([field.selectionStart, field.selectionEnd]).toEqual([1, 3])
      expect(controller.focused.value).toBe(true)
      expect(controller.open.value).toBe(false)
      expect(onOpen).not.toHaveBeenCalled()
      // Typing shows the suggestions again.
      await fireEvent.update(field, 'pag')
      expect(controller.open.value).toBe(true)
      expect(onOpen).toHaveBeenCalledOnce()
    } finally { view.unmount() }
  })

  it('opens no suggestions for the keyboard the field takes back before the tab is shown', async () => {
    const { view, controller, field, show, pageTakesKeyboard, onOpen, first, second } = mountField()
    try {
      // As Ctrl+L or a click gives the field the keyboard, with the page's address selected.
      field.focus()
      field.select()
      await show(second)
      await pageTakesKeyboard()
      onOpen.mockClear()
      // Hronaut's window takes the keyboard back, which goes back to the field it was in.
      controller.expectFocusReturn()
      field.focus()
      expect(onOpen).not.toHaveBeenCalled()
      await show(first)
      expect(controller.returnFocus('first')).toBe(true)
      expect(onOpen).not.toHaveBeenCalled()
      expect(controller.open.value).toBe(false)
      expect(controller.focused.value).toBe(true)
      // Selected whole, as the page's address was when the tab was left.
      expect([field.selectionStart, field.selectionEnd]).toEqual([0, first.url.length])

      // Without a return expected, the field taking the keyboard opens its suggestions as before.
      controller.expectFocusReturn()
      controller.cancelFocusReturn()
      screen.getByRole('button', { name: 'Elsewhere' }).focus()
      field.focus()
      expect(onOpen).toHaveBeenCalledOnce()
    } finally { view.unmount() }
  })

  it('selects all its text when the text changed since the tab was left', async () => {
    const { view, controller, field, show, pageTakesKeyboard, activeTab, second } = mountField()
    try {
      field.focus()
      field.setSelectionRange(2, 2)
      await show(second)
      await pageTakesKeyboard()
      // The page went to another while its tab was hidden.
      const moved = { ...tab('first', 'https://example.test/moved'), navigationGeneration: 1 }
      activeTab.value = moved
      await nextTick()
      await nextTick()
      expect(controller.returnFocus('first')).toBe(true)
      expect(field.value).toBe(moved.url)
      expect([field.selectionStart, field.selectionEnd]).toEqual([0, moved.url.length])
    } finally { view.unmount() }
  })

  it('takes nothing back for a tab not shown', async () => {
    const { view, controller, field, show, second } = mountField()
    try {
      await show(second)
      expect(controller.returnFocus('first')).toBe(false)
      expect(document.activeElement).not.toBe(field)
    } finally { view.unmount() }
  })
})
