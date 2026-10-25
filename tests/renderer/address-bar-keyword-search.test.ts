import { render, screen } from '@testing-library/vue'
import { computed, defineComponent, h as createElement, nextTick, ref, type Ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import BrowserAddressBar from '../../src/renderer/src/components/BrowserAddressBar.vue'
import { addressKeyword, keywordSearchTarget } from '../../src/renderer/src/address-keyword-search.js'
import type { ActiveTabPresentationController } from '../../src/renderer/src/composables/useActiveTabPresentationController.js'
import { useAddressBarController } from '../../src/renderer/src/composables/useAddressBarController.js'
import type { EmulationController } from '../../src/renderer/src/composables/useEmulationController.js'
import type { PageToolsPresentationController } from '../../src/renderer/src/composables/usePageToolsPresentationController.js'
import type { SiteDataSummaryController } from '../../src/renderer/src/composables/useSiteDataSummaryController.js'
import type { SitePermissionsController } from '../../src/renderer/src/composables/useSitePermissionsController.js'
import { createHronautI18n } from '../../src/renderer/src/i18n.js'
import type { AddressSuggestionOverlayRequest } from '../../src/shared/address-suggestions.js'
import type { BrowserHistoryEntry, BrowserTabState } from '../../src/shared/types.js'

// The address bar had no keyword search: "bing.com" and Tab left the field, and "bing.com cats" searched the default
// engine for the whole text. Chrome offers Tab to search an engine whose site the field shows, and Tab, or a space
// after the site, turns the field into a search box for it.

function tab(id: string, url: string): BrowserTabState {
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

function visit(id: string, url: string, visitCount = 2): BrowserHistoryEntry {
  return { id, title: `Visit ${id}`, url, visitedAt: '2026-10-25T00:00:00.000Z', visitCount }
}

function controllerOptions(active: Ref<BrowserTabState>, history: Ref<BrowserHistoryEntry[]>) {
  const onNavigate = vi.fn(async (_address: string) => undefined)
  const onOpenInNewTab = vi.fn(async (_address: string, _background: boolean) => undefined)
  const overlay = {
    show: vi.fn<(request: AddressSuggestionOverlayRequest) => void>(),
    hide: vi.fn(),
    returnFocus: vi.fn(),
    onSelected: vi.fn(() => () => undefined),
    onDismissed: vi.fn(() => () => undefined)
  }
  return {
    onNavigate,
    onOpenInNewTab,
    overlay,
    options: {
      activeTab: computed(() => active.value),
      tabs: computed(() => [active.value]),
      bookmarks: ref([]),
      history,
      overlay,
      theme: () => 'dark' as const,
      locale: () => 'en-US' as const,
      translate: (key: string) => key,
      formatNumber: String,
      onOpen: vi.fn(),
      onNavigate,
      onOpenInNewTab,
      onSwitchToTab: vi.fn(async () => true),
      onRemoveVisit: vi.fn(async () => undefined),
      onRemoveVisitFailed: vi.fn(),
      onFocusLeft: vi.fn()
    }
  }
}

function createHarness(entries: BrowserHistoryEntry[] = []) {
  const active = ref(tab('shown', 'https://shown.test/'))
  const history = ref<BrowserHistoryEntry[]>(entries)
  const { options, onNavigate, onOpenInNewTab, overlay } = controllerOptions(active, history)
  let controller!: ReturnType<typeof useAddressBarController>
  const Harness = defineComponent({
    setup() {
      controller = useAddressBarController(options)
      return controller
    },
    template: `
      <form ref="form" @submit.prevent="submit" @focusout="handleFocusOut">
        <input ref="input" v-model="address" aria-label="Address" @focus="handleFocus" @input="handleInput" @keydown="handleKeydown" />
      </form>
    `
  })
  render(Harness)
  const input = screen.getByRole<HTMLInputElement>('textbox', { name: 'Address' })
  return {
    controller,
    active,
    history,
    overlay,
    onNavigate,
    onOpenInNewTab,
    input,
    field: () => ({ value: input.value, caret: [input.selectionStart, input.selectionEnd] }),
    engine: () => controller.keyword.value?.engine ?? null,
    hint: () => controller.keywordHint.value?.engine ?? null
  }
}

// What a key press or other edit does to the field: the selected text gives way to it, and the field reports the input.
async function edit(input: HTMLInputElement, text: string, inputType = 'insertText', init: InputEventInit = {}): Promise<void> {
  if (document.activeElement !== input) input.focus()
  let start = input.selectionStart ?? input.value.length
  const end = input.selectionEnd ?? input.value.length
  if (start === end && inputType === 'deleteContentBackward') start = Math.max(0, start - 1)
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

describe('keyword search engines', () => {
  it('reads each built-in engine\'s site as its keyword, as Chrome reads a typed keyword', () => {
    expect(addressKeyword('bing.com')?.engine).toBe('bing')
    expect(addressKeyword('  Google.COM ')?.engine).toBe('google')
    expect(addressKeyword('https://www.duckduckgo.com/')?.engine).toBe('duckduckgo')
    expect(addressKeyword('http://search.brave.com')?.engine).toBe('brave')
    expect(addressKeyword('www.startpage.com')?.label).toBe('Startpage')
    for (const text of ['', 'bing', 'bing.co', 'bing.com/search', 'maps.google.com', 'bing.com cats', 'ftp://bing.com']) {
      expect(addressKeyword(text), text).toBeUndefined()
    }
  })

  it('searches the engine for the query, and opens its home page for an empty one', () => {
    const bing = addressKeyword('bing.com')!
    expect(keywordSearchTarget(bing, ' cats & dogs ')).toBe('https://www.bing.com/search?q=cats%20%26%20dogs')
    expect(keywordSearchTarget(bing, '   ')).toBe('https://www.bing.com/')
    expect(keywordSearchTarget(addressKeyword('startpage.com')!, 'a')).toBe('https://www.startpage.com/sp/search?query=a')
    expect(keywordSearchTarget(addressKeyword('search.brave.com')!, '')).toBe('https://search.brave.com/')
  })
})

describe('keyword search in the address bar', () => {
  it('offers Tab to search an engine whose site is typed, and Tab turns the field into a search box for it', async () => {
    const h = createHarness()
    await clear(h.input)
    await type(h.input, 'bing.co')
    expect(h.hint()).toBeNull()
    await type(h.input, 'm')
    expect(h.hint()).toBe('bing')
    const tabKey = await key(h.input, { key: 'Tab' })
    expect(tabKey.defaultPrevented).toBe(true)
    expect(h.engine()).toBe('bing')
    expect(h.hint()).toBeNull()
    expect(h.field()).toEqual({ value: '', caret: [0, 0] })
    // The field suggests nothing while it searches an engine.
    await type(h.input, 'cats')
    expect(h.controller.suggestions.value).toEqual([])
    expect(h.controller.visible.value).toBe(false)
    await h.controller.submit()
    expect(h.onNavigate).toHaveBeenCalledExactlyOnceWith('https://www.bing.com/search?q=cats')
    expect(h.engine()).toBeNull()
  })

  it('offers the engine whose site the field filled in after the typed text', async () => {
    const h = createHarness([visit('google', 'https://google.com/', 3)])
    await clear(h.input)
    await type(h.input, 'goo')
    expect(h.input.value).toBe('google.com')
    expect(h.hint()).toBe('google')
    await key(h.input, { key: 'Tab' })
    expect(h.engine()).toBe('google')
    expect(h.field()).toEqual({ value: '', caret: [0, 0] })
    // A query typed in the search box is never filled in as an address.
    await type(h.input, 'goo')
    expect(h.field()).toEqual({ value: 'goo', caret: [3, 3] })
    await h.controller.submit()
    expect(h.onNavigate).toHaveBeenCalledExactlyOnceWith('https://www.google.com/search?q=goo')
  })

  it('takes the keyword with a space typed after the site, and the text after it is the search', async () => {
    const h = createHarness()
    await clear(h.input)
    await type(h.input, 'duckduckgo.com ')
    expect(h.engine()).toBe('duckduckgo')
    expect(h.field()).toEqual({ value: '', caret: [0, 0] })
    await type(h.input, 'a b')
    await h.controller.submit()
    expect(h.onNavigate).toHaveBeenCalledExactlyOnceWith('https://duckduckgo.com/?q=a%20b')

    // A space typed between the site and text already there takes the site, and the text stays the search.
    await clear(h.input)
    await type(h.input, 'bing.comcats')
    h.input.setSelectionRange(8, 8)
    await edit(h.input, ' ')
    expect(h.engine()).toBe('bing')
    expect(h.field()).toEqual({ value: 'cats', caret: [0, 0] })
  })

  it('leaves a space pasted or composed after the site, and a site with a path, as text', async () => {
    const h = createHarness()
    await clear(h.input)
    await edit(h.input, 'bing.com ', 'insertFromPaste')
    expect(h.engine()).toBeNull()
    await clear(h.input)
    await type(h.input, 'bing.com')
    await edit(h.input, ' ', 'insertCompositionText', { isComposing: true })
    expect(h.engine()).toBeNull()
    await clear(h.input)
    await type(h.input, 'bing.com/maps ')
    expect(h.engine()).toBeNull()
    await h.controller.submit()
    expect(h.onNavigate).toHaveBeenCalledExactlyOnceWith('bing.com/maps ')
  })

  it('gives the site back, with the search after it, on Backspace at the start of the search', async () => {
    const h = createHarness()
    await clear(h.input)
    await type(h.input, 'bing.com cats')
    expect(h.engine()).toBe('bing')
    // Backspace inside the search edits it as usual.
    h.input.setSelectionRange(2, 2)
    expect((await key(h.input, { key: 'Backspace' })).defaultPrevented).toBe(false)
    h.input.setSelectionRange(0, 2)
    expect((await key(h.input, { key: 'Backspace' })).defaultPrevented).toBe(false)
    expect(h.engine()).toBe('bing')
    h.input.setSelectionRange(0, 0)
    const back = await key(h.input, { key: 'Backspace' })
    expect(back.defaultPrevented).toBe(true)
    expect(h.engine()).toBeNull()
    expect(h.field()).toEqual({ value: 'bing.com cats', caret: [8, 8] })
    expect(h.controller.address.value).toBe('bing.com cats')
    // A space there takes the site again, with the search as it was.
    await edit(h.input, ' ')
    expect(h.engine()).toBe('bing')
    expect(h.field()).toEqual({ value: 'cats', caret: [0, 0] })
    await key(h.input, { key: 'Backspace' })
    expect(h.engine()).toBeNull()
    // With no search, the site alone, and Tab offered again.
    await clear(h.input)
    await type(h.input, 'bing.com')
    await key(h.input, { key: 'Tab' })
    await key(h.input, { key: 'Backspace' })
    expect(h.field()).toEqual({ value: 'bing.com', caret: [8, 8] })
    expect(h.hint()).toBe('bing')
  })

  it('opens the engine\'s home page for an empty search, and a new tab with Alt+Enter', async () => {
    const h = createHarness()
    await clear(h.input)
    await type(h.input, 'bing.com ')
    await h.controller.submit()
    expect(h.onNavigate).toHaveBeenCalledExactlyOnceWith('https://www.bing.com/')

    await clear(h.input)
    await type(h.input, 'bing.com dogs')
    // A tab opened behind leaves the search as it is, to open another.
    await key(h.input, { key: 'Enter', altKey: true, shiftKey: true })
    expect(h.onOpenInNewTab).toHaveBeenLastCalledWith('https://www.bing.com/search?q=dogs', true)
    expect(h.engine()).toBe('bing')
    await key(h.input, { key: 'Enter', altKey: true })
    expect(h.onOpenInNewTab).toHaveBeenLastCalledWith('https://www.bing.com/search?q=dogs', false)
    expect(h.engine()).toBeNull()
    expect(h.field().value).toBe('https://shown.test/')

    // Ctrl+Enter searches as Enter does, without adding www. and .com.
    await clear(h.input)
    await type(h.input, 'bing.com news')
    await key(h.input, { key: 'Enter', ctrlKey: true })
    expect(h.onNavigate).toHaveBeenLastCalledWith('https://www.bing.com/search?q=news')
  })

  it('takes the keyword once for a held Tab, which then keeps the keyboard in the field', async () => {
    const h = createHarness()
    await clear(h.input)
    await type(h.input, 'bing.com')
    await key(h.input, { key: 'Tab' })
    expect((await key(h.input, { key: 'Tab', repeat: true })).defaultPrevented).toBe(true)
    expect((await key(h.input, { key: 'Tab', repeat: true })).defaultPrevented).toBe(true)
    // A new press leaves the field as Tab does.
    expect((await key(h.input, { key: 'Tab' })).defaultPrevented).toBe(false)
    expect(h.engine()).toBe('bing')
  })

  it('offers no keyword for the page\'s own address, a highlighted row, or Tab with a modifier', async () => {
    const h = createHarness([visit('bing', 'https://bing.com/', 3)])
    h.active.value = tab('shown', 'https://bing.com/')
    await nextTick()
    h.input.focus()
    expect(h.field().value).toBe('https://bing.com/')
    expect(h.hint()).toBeNull()
    expect((await key(h.input, { key: 'Tab' })).defaultPrevented).toBe(false)

    await clear(h.input)
    await type(h.input, 'bing.com')
    expect(h.hint()).toBe('bing')
    for (const modifier of ['shiftKey', 'ctrlKey', 'altKey', 'metaKey'] as const) {
      expect((await key(h.input, { key: 'Tab', [modifier]: true })).defaultPrevented, modifier).toBe(false)
    }
    expect(h.engine()).toBeNull()
    await key(h.input, { key: 'ArrowDown' })
    expect(h.controller.selected.value?.id).toBe('history:bing')
    expect(h.hint()).toBeNull()
  })

  it('leaves the search with Escape, a tab change or a navigation', async () => {
    const h = createHarness()
    await clear(h.input)
    await type(h.input, 'bing.com cats')
    await key(h.input, { key: 'Escape' })
    expect(h.engine()).toBeNull()
    expect(h.field().value).toBe('https://shown.test/')

    await clear(h.input)
    await type(h.input, 'bing.com cats')
    h.active.value = tab('other', 'https://other.test/')
    await nextTick()
    expect(h.engine()).toBeNull()
    expect(h.field().value).toBe('https://other.test/')

    await clear(h.input)
    await type(h.input, 'bing.com cats')
    await h.controller.pasteAndGo('example.test')
    expect(h.engine()).toBeNull()
    expect(h.onNavigate).toHaveBeenLastCalledWith('example.test')
  })

  it('keeps the search when the field is left and comes back to it', async () => {
    const h = createHarness()
    await clear(h.input)
    await type(h.input, 'bing.com cats')
    h.input.blur()
    await new Promise(resolve => setTimeout(resolve, 0))
    await nextTick()
    expect(h.engine()).toBe('bing')
    expect(h.field().value).toBe('cats')
    expect(h.hint()).toBeNull()
  })
})

describe('the address bar\'s keyword chip and hint', () => {
  it('shows Tab to search the engine, then a chip naming it before the search, and tells a screen reader', async () => {
    const active = ref(tab('shown', 'https://shown.test/'))
    const { options } = controllerOptions(active, ref<BrowserHistoryEntry[]>([]))
    const Wrapper = defineComponent({
      setup() {
        const addressController = useAddressBarController(options)
        return () => createElement(BrowserAddressBar, {
          siteControlsOpen: false,
          panelDock: 'right',
          activeTab: active.value,
          addressController,
          activeTabPresentation: {
            activeWebUrl: ref('https://shown.test/'),
            activeOrigin: ref('https://shown.test'),
            activeHostname: ref('shown.test'),
            activeSitePermissions: ref([]),
            activeAddressKind: ref('Secure HTTPS connection'),
            activeTabUsesDefaultProfile: ref(true)
          } as unknown as ActiveTabPresentationController,
          emulationController: { activeEmulation: ref(undefined), resetPending: ref(false), label: vi.fn(), describe: vi.fn() } as unknown as EmulationController,
          pageToolsPresentation: { activeNetworkRouteCount: ref(0) } as unknown as PageToolsPresentationController,
          siteDataController: { summary: ref(null), state: ref('idle'), message: ref(''), refresh: vi.fn() } as unknown as SiteDataSummaryController,
          sitePermissionsController: { permissionLabel: (value: string) => value, isPending: () => false } as unknown as SitePermissionsController,
          locale: 'en-US',
          formatNumber: String,
          runAction: (action: () => unknown) => action(),
          keepsSeparatePanelOpen: () => false,
          actions: {
            toggleSiteControls: vi.fn(),
            resetActiveTabEmulation: vi.fn(),
            clearActiveCssStatePreview: vi.fn(),
            stopActiveVirtualPasskey: vi.fn(),
            stopActiveLogpoints: vi.fn(),
            openRequestConditions: vi.fn(),
            setSitePermission: vi.fn(async () => true),
            resetSitePermission: vi.fn(async () => true),
            openSitePermissionSettings: vi.fn(),
            openSitePrivacySettings: vi.fn()
          }
        })
      }
    })
    render(Wrapper, { global: { plugins: [createHronautI18n('en-US')] } })
    const input = screen.getByRole<HTMLInputElement>('combobox', { name: 'Address' })
    const status = screen.getByRole('status')
    expect(status).toHaveTextContent(/^$/u)
    await clear(input)
    await type(input, 'search.brave.com')
    const hint = () => document.querySelector('.address-keyword-hint')
    expect(hint()).toHaveTextContent('Press Tab to search Brave Search')
    expect(hint()).toHaveAttribute('aria-hidden', 'true')
    expect(status).toHaveTextContent('Press Tab to search Brave Search')
    expect(input).toHaveAttribute('placeholder', 'Search or enter address')
    expect(input).not.toHaveAttribute('aria-describedby')

    await key(input, { key: 'Tab' })
    expect(hint()).toBeNull()
    const chip = document.getElementById('address-keyword')
    expect(chip).toHaveTextContent('Search Brave Search')
    // The chip comes before the search.
    expect(chip!.compareDocumentPosition(input) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(input).toHaveAttribute('aria-describedby', 'address-keyword')
    expect(input).toHaveAttribute('placeholder', '')
    expect(status).toHaveTextContent('Search Brave Search')

    await key(input, { key: 'Backspace' })
    expect(document.getElementById('address-keyword')).toBeNull()
    expect(input).toHaveValue('search.brave.com')
    expect(hint()).toHaveTextContent('Press Tab to search Brave Search')
    expect(status).toHaveTextContent('Press Tab to search Brave Search')
  })
})
