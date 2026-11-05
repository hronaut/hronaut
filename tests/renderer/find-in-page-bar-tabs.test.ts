import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { shallowRef } from 'vue'
import FindInPageBar from '../../src/renderer/src/features/find/FindInPageBar.vue'
import { createHronautI18n } from '../../src/renderer/src/i18n.js'
import type { BrowserFindResult, BrowserTabState } from '../../src/shared/types.js'

function tab(id: string, changes: Partial<BrowserTabState> = {}): BrowserTabState {
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
    devToolsOpen: false,
    ...changes
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise })
  return { promise, resolve }
}

type FindRequest = { tabId: string; query: string; forward: boolean; findNext: boolean; caseSensitive: boolean }
type Exposed = { openForTab(tab?: BrowserTabState, again?: 'next' | 'previous'): Promise<void>; returnFocus(tabId: string): boolean }

// As in Chrome, whose find bar belongs to its tab: another tab hides it and the tab shown again brings it back. Find
// closed on every tab switch and ended the page's search, so coming back to a tab meant searching it again.
describe('Find in each tab', () => {
  function mountBar(options: { find?: (request: FindRequest) => Promise<BrowserFindResult> } = {}) {
    const first = tab('first')
    const second = tab('second')
    const browser = {
      findInPage: vi.fn(options.find ?? (async (_request: FindRequest): Promise<BrowserFindResult> => ({ activeMatchOrdinal: 1, matches: 3 }))),
      stopFindInPage: vi.fn(async (_tabId: string, _options?: unknown) => undefined),
      forwardFindKey: vi.fn(async () => undefined),
      findSelectionText: vi.fn(async (_tabId: string) => ''),
      focusActivePage: vi.fn(async () => undefined)
    }
    const openTabs = shallowRef<readonly BrowserTabState[]>([first, second])
    const wrapper = mount(FindInPageBar, {
      attachTo: document.body,
      global: { plugins: [createHronautI18n('en-US')] },
      props: {
        open: false,
        activeTab: first,
        readTabs: () => openTabs.value,
        browser,
        'onUpdate:open': (next: boolean) => wrapper.setProps({ open: next })
      }
    })
    const exposed = wrapper.vm as unknown as Exposed
    const field = () => wrapper.find<HTMLInputElement>('input[type="search"]')
    const count = () => wrapper.find('.find-count').text()
    const show = async (shown: BrowserTabState, tabs?: BrowserTabState[]) => {
      if (tabs) openTabs.value = tabs
      await wrapper.setProps({ activeTab: shown })
      await flushPromises()
    }
    const searchFor = async (query: string) => {
      await field().setValue(query)
      await flushPromises()
    }
    return { wrapper, browser, exposed, field, count, show, searchFor, first, second }
  }

  it('hides Find for another tab, leaving the page\'s search, and brings it back with its text and match', async () => {
    let ordinal = 0
    const { wrapper, browser, exposed, field, count, show, searchFor, first, second } = mountBar({
      find: async () => ({ activeMatchOrdinal: ++ordinal, matches: 3 })
    })
    try {
      await exposed.openForTab(first)
      await searchFor('needle')
      await field().trigger('keydown', { key: 'Enter' })
      await flushPromises()
      expect(count()).toBe('2 / 3')
      await wrapper.find('button[aria-label="Match case"]').trigger('click')
      await flushPromises()
      expect(count()).toBe('3 / 3')
      browser.findInPage.mockClear()
      browser.stopFindInPage.mockClear()

      await show(second)
      expect(wrapper.props('open')).toBe(false)
      // The page keeps its search, whose matches stay marked, and selects nothing.
      expect(browser.stopFindInPage).not.toHaveBeenCalled()

      await show(first)
      expect(wrapper.props('open')).toBe(true)
      expect(field().element.value).toBe('needle')
      expect(count()).toBe('3 / 3')
      expect(wrapper.find('button[aria-label="Match case"]').attributes('aria-pressed')).toBe('true')
      // It searched nothing again: Enter goes on to the next match of the same search.
      expect(browser.findInPage).not.toHaveBeenCalled()
      ordinal = 0
      await field().trigger('keydown', { key: 'Enter' })
      await flushPromises()
      expect(browser.findInPage).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
        tabId: 'first', query: 'needle', forward: true, findNext: false, caseSensitive: true
      }))
      expect(browser.stopFindInPage).not.toHaveBeenCalled()
    } finally { wrapper.unmount() }
  })

  it('keeps each tab\'s own Find, and none for a tab that had none', async () => {
    const { wrapper, exposed, field, count, show, searchFor, first, second } = mountBar({
      find: async (request) => ({ activeMatchOrdinal: 1, matches: request.query === 'alpha' ? 2 : 5 })
    })
    try {
      await exposed.openForTab(first)
      await searchFor('alpha')
      await show(second)
      expect(wrapper.props('open')).toBe(false)
      await exposed.openForTab(second)
      await searchFor('beta')
      expect(count()).toBe('1 / 5')

      await show(first)
      expect(field().element.value).toBe('alpha')
      expect(count()).toBe('1 / 2')
      await show(second)
      expect(field().element.value).toBe('beta')
      expect(count()).toBe('1 / 5')

      // Closed in a tab, Find stays closed there.
      await field().trigger('keydown', { key: 'Escape' })
      await flushPromises()
      await show(first)
      expect(field().element.value).toBe('alpha')
      await show(second)
      expect(wrapper.props('open')).toBe(false)
    } finally { wrapper.unmount() }
  })

  it('never shows one tab\'s count in another tab\'s Find', async () => {
    const selected = deferred<string>()
    const { wrapper, browser, exposed, count, show, searchFor, first, second } = mountBar()
    try {
      await exposed.openForTab(first)
      await searchFor('needle')
      expect(count()).toBe('1 / 3')
      await show(second)
      browser.findSelectionText.mockImplementationOnce(() => selected.promise)
      browser.findInPage.mockClear()
      const opening = exposed.openForTab(second)
      await flushPromises()
      expect(count()).not.toBe('1 / 3')
      // Hidden again before it read the page's selected text, it searched nothing there.
      await show(tab('third'), [first, second, tab('third')])
      selected.resolve('')
      await opening
      await show(second)
      expect(count()).toBe('0 / 0')
      expect(wrapper.find('button[aria-label="Next match"]').attributes('aria-disabled')).toBe('true')
      expect(browser.findInPage).not.toHaveBeenCalled()
    } finally { wrapper.unmount() }
  })

  it('shows the answer of a search still running when the tab was hidden, whenever it comes', async () => {
    const answers: Array<ReturnType<typeof deferred<BrowserFindResult>>> = []
    const { wrapper, exposed, count, show, searchFor, first, second } = mountBar({
      find: () => {
        const answer = deferred<BrowserFindResult>()
        answers.push(answer)
        return answer.promise
      }
    })
    try {
      await exposed.openForTab(first)
      await searchFor('needle')
      expect(count()).toBe('Searching…')
      await show(second)
      // It answers while the tab is hidden.
      answers[0].resolve({ activeMatchOrdinal: 1, matches: 4 })
      await flushPromises()
      await show(first)
      expect(count()).toBe('1 / 4')

      await searchFor('needles')
      await show(second)
      await show(first)
      expect(count()).toBe('Searching…')
      // It answers once the tab is shown again.
      answers[1].resolve({ activeMatchOrdinal: 1, matches: 2 })
      await flushPromises()
      expect(count()).toBe('1 / 2')
    } finally { wrapper.unmount() }
  })

  it('ends a hidden Find whose tab goes to another page, sleeps or closes', async () => {
    const { wrapper, browser, exposed, show, searchFor, first, second } = mountBar()
    try {
      await exposed.openForTab(first)
      await searchFor('needle')
      await show(second)
      browser.stopFindInPage.mockClear()
      // The page the search marked is gone, so the search ends keeping the new page's selection.
      const reloaded = tab('first', { navigationGeneration: 1, documentGeneration: 1 })
      await show(second, [reloaded, second])
      expect(browser.stopFindInPage).toHaveBeenCalledExactlyOnceWith('first', { clearSelection: true })
      await show(reloaded)
      expect(wrapper.props('open')).toBe(false)

      // Gone to another page in the state that shows the tab again.
      await exposed.openForTab(reloaded)
      await searchFor('needle')
      await show(second)
      browser.stopFindInPage.mockClear()
      await show(tab('first', { navigationGeneration: 2, documentGeneration: 2 }))
      expect(wrapper.props('open')).toBe(false)
      expect(browser.stopFindInPage).toHaveBeenCalledExactlyOnceWith('first', { clearSelection: true })

      // Asleep, the tab holds no page.
      const third = tab('third')
      await show(third, [reloaded, second, third])
      await exposed.openForTab(third)
      await searchFor('needle')
      await show(second)
      browser.stopFindInPage.mockClear()
      await show(second, [reloaded, second, { ...third, sleeping: true }])
      await show({ ...third, sleeping: true })
      expect(wrapper.props('open')).toBe(false)

      // Closed, it takes its Find with it.
      const fourth = tab('fourth')
      await show(fourth, [reloaded, second, fourth])
      await exposed.openForTab(fourth)
      await searchFor('needle')
      await show(second, [reloaded, second])
      await show(fourth, [reloaded, second, fourth])
      expect(wrapper.props('open')).toBe(false)
      expect(browser.stopFindInPage).not.toHaveBeenCalled()
    } finally { wrapper.unmount() }
  })

  it('waits while another surface is open, and comes back once it closes or the person opens Find', async () => {
    const { wrapper, browser, exposed, field, count, show, searchFor, first, second } = mountBar()
    try {
      await exposed.openForTab(first)
      await searchFor('needle')
      await show(second)
      await wrapper.setProps({ returnHeld: true })
      await show(first)
      expect(wrapper.props('open')).toBe(false)
      await wrapper.setProps({ returnHeld: false })
      await flushPromises()
      expect(wrapper.props('open')).toBe(true)
      expect(count()).toBe('1 / 3')

      await show(second)
      await wrapper.setProps({ returnHeld: true })
      await show(first)
      browser.findInPage.mockClear()
      browser.findSelectionText.mockClear()
      // Find opened then goes on with the tab's search, with its text selected in the field.
      await exposed.openForTab(first)
      await flushPromises()
      expect(wrapper.props('open')).toBe(true)
      expect(field().element.value).toBe('needle')
      expect(document.activeElement).toBe(field().element)
      expect([field().element.selectionStart, field().element.selectionEnd]).toEqual([0, 6])
      expect(count()).toBe('1 / 3')
      expect(browser.findInPage).not.toHaveBeenCalled()
      // The text typed in the tab's Find stays, rather than give way to the page's selected text, as in Chrome.
      expect(browser.findSelectionText).not.toHaveBeenCalled()
      await exposed.openForTab(first, 'next')
      expect(browser.findInPage).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ tabId: 'first', findNext: false }))
    } finally { wrapper.unmount() }
  })

  it('gives its field the keyboard back, all its text selected, for the tab it came back with', async () => {
    const { wrapper, exposed, field, show, searchFor, first, second } = mountBar()
    try {
      await exposed.openForTab(first)
      await searchFor('needle')
      await show(second)
      // Not open for the tab shown.
      expect(exposed.returnFocus('second')).toBe(false)
      ;(document.activeElement as HTMLElement | null)?.blur()
      await show(first)
      expect(document.activeElement).not.toBe(field().element)
      expect(exposed.returnFocus('second')).toBe(false)
      expect(exposed.returnFocus('first')).toBe(true)
      expect(document.activeElement).toBe(field().element)
      expect([field().element.selectionStart, field().element.selectionEnd]).toEqual([0, 6])
      expect(wrapper.emitted('update:focused')?.at(-1)).toEqual([true])

      await field().trigger('keydown', { key: 'Escape' })
      await flushPromises()
      expect(exposed.returnFocus('first')).toBe(false)
    } finally { wrapper.unmount() }
  })
})
