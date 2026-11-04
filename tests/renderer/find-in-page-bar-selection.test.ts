import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import FindInPageBar from '../../src/renderer/src/features/find/FindInPageBar.vue'
import { createHronautI18n } from '../../src/renderer/src/i18n.js'
import type { BrowserFindResult, BrowserTabState } from '../../src/shared/types.js'

function tab(id: string): BrowserTabState {
  return {
    id,
    title: `Page ${id}`,
    url: `https://example.test/${id}`,
    loading: false,
    navigationGeneration: 0,
    documentGeneration: 0,
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

// Find opened with its last text, where Chrome's opens with the text selected in the page and finds it there.
describe('taking up the text selected in the page', () => {
  type Exposed = { openForTab(tab?: BrowserTabState, again?: 'next' | 'previous'): Promise<void> }

  function mountBar(selected: () => Promise<string>) {
    const activeTab = tab('first')
    const browser = {
      findInPage: vi.fn(async (_request: unknown): Promise<BrowserFindResult> => ({ activeMatchOrdinal: 1, matches: 3 })),
      stopFindInPage: vi.fn(async (_tabId: string) => undefined),
      forwardFindKey: vi.fn(async () => undefined),
      findSelectionText: vi.fn(async (_tabId: string) => selected()),
      focusActivePage: vi.fn(async () => undefined)
    }
    const wrapper = mount(FindInPageBar, {
      attachTo: document.body,
      global: { plugins: [createHronautI18n('en-US')] },
      props: { open: false, activeTab, browser, 'onUpdate:open': (next: boolean) => wrapper.setProps({ open: next }) }
    })
    const exposed = wrapper.vm as unknown as Exposed
    const field = () => wrapper.find<HTMLInputElement>('input[type="search"]')
    // Find with a last text, closed with Escape.
    const searchedAndClosed = async () => {
      await exposed.openForTab(activeTab)
      await field().setValue('needle')
      await flushPromises()
      await field().trigger('keydown', { key: 'Escape' })
      await flushPromises()
      browser.findInPage.mockClear()
      browser.findSelectionText.mockClear()
    }
    return { wrapper, browser, activeTab, exposed, field, searchedAndClosed }
  }

  const request = (query: string) => ({ tabId: 'first', query, forward: true, findNext: true, caseSensitive: false, fromSelectionStart: true })

  it('opens Find with it and finds it there, from the start of the selection, so the selected text itself', async () => {
    const { wrapper, browser, activeTab, exposed, field, searchedAndClosed } = mountBar(async () => 'haystack')
    try {
      await searchedAndClosed()

      await exposed.openForTab(activeTab)
      await flushPromises()

      expect(browser.findSelectionText).toHaveBeenCalledExactlyOnceWith('first')
      expect(field().element.value).toBe('haystack')
      expect([field().element.selectionStart, field().element.selectionEnd]).toEqual([0, 'haystack'.length])
      expect(browser.findInPage).toHaveBeenCalledExactlyOnceWith(request('haystack'))
    } finally { wrapper.unmount() }
  })

  it('opens Find with its last text with nothing selected, and also when it opens another way', async () => {
    const { wrapper, browser, field, searchedAndClosed } = mountBar(async () => '')
    try {
      await searchedAndClosed()

      await wrapper.setProps({ open: true })
      await flushPromises()

      expect(browser.findSelectionText).toHaveBeenCalledExactlyOnceWith('first')
      expect(field().element.value).toBe('needle')
      expect(browser.findInPage).toHaveBeenCalledExactlyOnceWith(request('needle'))
    } finally { wrapper.unmount() }
  })

  it('takes it up with Find pressed again in an open bar until the person types in the field, and not after', async () => {
    let selected = ''
    const { wrapper, browser, activeTab, exposed, field, searchedAndClosed } = mountBar(async () => selected)
    try {
      await searchedAndClosed()
      await exposed.openForTab(activeTab)
      await flushPromises()
      browser.findInPage.mockClear()

      selected = 'haystack'
      await exposed.openForTab(activeTab)
      await flushPromises()
      expect(field().element.value).toBe('haystack')
      expect(browser.findInPage).toHaveBeenCalledExactlyOnceWith(request('haystack'))

      await field().setValue('typed')
      await flushPromises()
      browser.findInPage.mockClear()
      browser.findSelectionText.mockClear()
      await exposed.openForTab(activeTab)
      await flushPromises()
      expect(browser.findSelectionText).not.toHaveBeenCalled()
      expect(browser.findInPage).not.toHaveBeenCalled()
      expect(field().element.value).toBe('typed')
    } finally { wrapper.unmount() }
  })

  it('keeps what the person typed while the page answered', async () => {
    let answer!: (text: string) => void
    const { wrapper, browser, activeTab, exposed, field } = mountBar(() => new Promise((resolve) => { answer = resolve }))
    try {
      const opening = exposed.openForTab(activeTab)
      await flushPromises()
      await field().setValue('typed')
      answer('haystack')
      await opening
      await flushPromises()

      expect(field().element.value).toBe('typed')
      expect(browser.findInPage.mock.calls.map(([options]) => (options as { query: string }).query)).toEqual(['typed'])
    } finally { wrapper.unmount() }
  })

  it('leaves the page\'s answer once the person typed, searched or pressed Find again meanwhile, so nothing goes back', async () => {
    const answers: Array<(text: string) => void> = []
    let selected: () => Promise<string> = async () => ''
    const { wrapper, browser, activeTab, exposed, field, searchedAndClosed } = mountBar(() => selected())
    const queries = () => browser.findInPage.mock.calls.map(([options]) => options as { query: string; findNext: boolean })
    try {
      await searchedAndClosed()
      selected = () => new Promise((resolve) => { answers.push(resolve) })

      // Typed while the page answered, with a last text Find would search for again.
      const typing = exposed.openForTab(activeTab)
      await flushPromises()
      await field().setValue('typed')
      answers.shift()!('haystack')
      await typing
      await flushPromises()
      expect(field().element.value).toBe('typed')
      expect(queries().map(({ query }) => query)).toEqual(['typed'])

      // Enter pressed while the page answered starts the search, which the page's answer leaves alone.
      await field().trigger('keydown', { key: 'Escape' })
      await flushPromises()
      browser.findInPage.mockClear()
      const entering = exposed.openForTab(activeTab)
      await flushPromises()
      await field().trigger('keydown', { key: 'Enter' })
      answers.shift()!('haystack')
      await entering
      await flushPromises()
      expect(field().element.value).toBe('typed')
      expect(queries()).toEqual([expect.objectContaining({ query: 'typed', findNext: true })])

      // Find pressed twice in the open bar while the page answered: the newer answer is the one taken up.
      browser.findInPage.mockClear()
      const first = exposed.openForTab(activeTab)
      const second = exposed.openForTab(activeTab)
      await flushPromises()
      answers.shift()!('older')
      answers.shift()!('haystack')
      await Promise.all([first, second])
      await flushPromises()
      expect(queries().map(({ query }) => query)).toEqual(['haystack'])
    } finally { wrapper.unmount() }
  })

  it('shows Find searching while the page answers, for the text it has, and the count once Find searched', async () => {
    let answer!: (text: string) => void
    let selected: () => Promise<string> = async () => ''
    const { wrapper, activeTab, exposed, searchedAndClosed } = mountBar(() => selected())
    const count = () => wrapper.find('.find-count')
    try {
      await searchedAndClosed()
      selected = () => new Promise((resolve) => { answer = resolve })
      const opening = exposed.openForTab(activeTab)
      await flushPromises()
      expect(count().text()).toBe('Searching…')
      expect(count().attributes('aria-busy')).toBe('true')
      expect(wrapper.find('button[aria-label="Next match"]').attributes('aria-disabled')).toBe('true')
      answer('')
      await opening
      await flushPromises()
      expect(count().text()).toBe('1 / 3')
      expect(count().attributes('aria-busy')).toBe('false')
    } finally { wrapper.unmount() }
  })

  it('searches nothing for its last text while an input method composes in the field as the page answers', async () => {
    let answer!: (text: string) => void
    let selected: () => Promise<string> = async () => ''
    const { wrapper, browser, activeTab, exposed, field, searchedAndClosed } = mountBar(() => selected())
    try {
      await searchedAndClosed()
      selected = () => new Promise((resolve) => { answer = resolve })
      const opening = exposed.openForTab(activeTab)
      await flushPromises()
      field().element.value = 'にほ'
      field().element.dispatchEvent(new InputEvent('input', { isComposing: true }))
      answer('haystack')
      await opening
      await flushPromises()
      expect(browser.findInPage).not.toHaveBeenCalled()
      expect(field().element.value).toBe('にほ')
    } finally { wrapper.unmount() }
  })

  it.each([['next', true], ['previous', false]] as const)('leaves it with Find %s, which searches for the last text', async (again, forward) => {
    const { wrapper, browser, activeTab, exposed, field, searchedAndClosed } = mountBar(async () => 'haystack')
    try {
      await searchedAndClosed()

      await exposed.openForTab(activeTab, again)
      await flushPromises()

      expect(browser.findSelectionText).not.toHaveBeenCalled()
      expect(field().element.value).toBe('needle')
      expect(browser.findInPage).toHaveBeenCalledExactlyOnceWith({ tabId: 'first', query: 'needle', forward, findNext: true, caseSensitive: false })
    } finally { wrapper.unmount() }
  })
})
