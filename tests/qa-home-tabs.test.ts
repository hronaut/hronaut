// @vitest-environment jsdom
// Home's Tabs view, which Search tabs (Ctrl/Cmd+Shift+A) opens: the open tabs by workspace with their pictures and
// conditions, archived workspaces and recently closed tabs, the search and result types, keys, card actions, labels and
// the full-page preview. Main does every action; these tests answer for it.
import { describe, expect, it, vi } from 'vitest'
import type { HomeTab, HomeTabAction, HomeTabsState } from '../src/shared/home-tabs.js'
import type { HronautHomeApi } from '../src/shared/home.js'
import type { BrowserTabOverviewPreview } from '../src/shared/types.js'
import { byId, deferred, flush, installHomeHooks, isoMinutesAgo, mountTestHome, query, words } from './qa-home-harness.js'

installHomeHooks()

const FRAME = 'data:image/jpeg;base64,AAAA'

function tab(id: string, overrides: Partial<HomeTab> = {}): HomeTab {
  return {
    id, title: `Page ${id}`, url: `https://${id}.example.com/docs`, loading: false, sleeping: false, pinned: false, muted: false,
    audible: false, locked: false, agentActive: false, navigationGeneration: 1, ...overrides
  }
}

function tabsState(overrides: Partial<HomeTabsState> = {}): HomeTabsState {
  return {
    workspaces: [{ id: 'shop', name: 'Acme Store', color: 'blue' }],
    tabs: [tab('cart', { workspaceId: 'shop', title: 'Cart', label: 'Checkout QA' }), tab('docs', { title: 'Docs' }), tab('news', { title: 'News', url: 'https://news.example.org/' })],
    previousTabId: 'docs',
    closedTabs: [{ id: 'closed-1', title: 'Pricing', url: 'https://pricing.example.com/', pinned: false, closedAt: isoMinutesAgo(5) }],
    archivedWorkspaces: [{ id: 'old', name: 'Old project', color: 'green', deletionProtected: false, tabs: [{ title: 'Board', url: 'https://board.example.com/' }, { title: 'Wiki', url: 'https://wiki.example.com/' }] }],
    locked: false,
    ...overrides
  }
}

interface TabsHarness {
  api: Partial<HronautHomeApi>
  tabAction: ReturnType<typeof vi.fn<(action: HomeTabAction) => Promise<HomeTabsState>>>
  getTabs: ReturnType<typeof vi.fn<() => Promise<HomeTabsState>>>
  getTabPreviews: ReturnType<typeof vi.fn<(tabIds: string[]) => Promise<BrowserTabOverviewPreview[]>>>
  /** What main answers from now on, to reads and actions alike. */
  set(next: HomeTabsState): void
  /** Search tabs: main asks Home to show its Tabs view. */
  showTabs(): Promise<void>
}

function mountTabs(initial = tabsState(), api: Partial<HronautHomeApi> = {}): TabsHarness {
  let current = initial
  let showTabs: (() => void) | undefined
  const getTabs = vi.fn(async () => current)
  const tabAction = vi.fn(async (_action: HomeTabAction) => current)
  const getTabPreviews = vi.fn(async (_tabIds: string[]): Promise<BrowserTabOverviewPreview[]> => [])
  const harness = mountTestHome({
    api: {
      getTabs, tabAction, getTabPreviews,
      onShowTabs: listener => { showTabs = listener; return () => { showTabs = undefined } },
      ...api
    }
  })
  return {
    api: harness.api, tabAction, getTabs, getTabPreviews,
    set(next) { current = next },
    async showTabs() { showTabs!(); await flush() }
  }
}

const card = (id: string): HTMLElement => query(`[data-result-key="open:${id}"]`)
const sectionTitles = (): string[] => [...document.querySelectorAll('#tab-results .tab-section h3')].map(words)
const key = (target: Element, value: string, init: KeyboardEventInit = {}): KeyboardEvent => {
  const event = new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true, ...init })
  target.dispatchEvent(event)
  return event
}

describe('Home Tabs view', () => {
  it('is the first Home section, and Search tabs shows it with the search field focused and the current tab selected', async () => {
    const tabs = mountTabs()
    expect(words(query('.home-navigation button'))).toBe('Tabs')
    expect(byId('home-tabs').hidden).toBe(true)
    expect(tabs.getTabs).not.toHaveBeenCalled()
    await tabs.showTabs()
    expect(byId('home-tabs').hidden).toBe(false)
    expect(byId('home-tab-tabs').getAttribute('aria-selected')).toBe('true')
    expect(words(byId('home-view-title'))).toBe('Tabs')
    expect(words(byId('home-view-description'))).toBe('3 open · 1 saved · 1 closed')
    expect(document.activeElement).toBe(byId('tab-search'))
    expect(card('docs').classList.contains('selected')).toBe(true)
    expect(byId('tab-search').getAttribute('aria-activedescendant')).toBe('tab-result-open-docs')
    expect(words(byId('tab-search-keys'))).toBe('Ctrl+Shift+A')
    expect(words(byId('tabs-hint-back'))).toBe('Esc Back to Docs')
  })

  it('lists tabs by workspace, then other tabs, archived workspaces and recently closed tabs', async () => {
    const tabs = mountTabs()
    await tabs.showTabs()
    expect(sectionTitles()).toEqual(['Acme Store1', 'Other tabs2', 'Archived workspaces1', 'Recently closed1'])
    expect(words(query('.tab-card-title strong', card('cart')))).toBe('Checkout QA')
    expect(words(query('.tab-card-page-title', card('cart')))).toBe('Cart')
    expect(words(query('.tab-card-url', card('cart')))).toBe('cart.example.com/docs')
    expect(words(query('.tab-card-current', card('docs')))).toBe('Current tab')
    expect(card('cart').querySelector('.tab-card-current')).toBeNull()
    expect(words(query('[data-result-key="saved:old"]'))).toContain('2 saved tabs')
    expect(words(query('[data-result-key="saved:old"]'))).toContain('Board · Wiki')
    expect(words(query('[data-result-key="closed:closed-1"]'))).toContain('Closed 5 min ago')
  })

  it('names each condition on its card, and its workspace only by the section it is in', async () => {
    const tabs = mountTabs(tabsState({
      tabs: [tab('busy', {
        workspaceId: 'shop', agentActive: true, pinned: true, locked: true, muted: true, audible: true, networkRouteCount: 2,
        emulation: { network: 'offline', cacheDisabled: false, bypassServiceWorker: false, dataSaver: 'auto', javaScriptDisabled: false, cpuThrottlingRate: 1 } as HomeTab['emulation']
      })]
    }))
    await tabs.showTabs()
    const conditions = [...card('busy').querySelectorAll('.condition')].map(words)
    expect(conditions).toEqual(['Agent active', 'Pinned', 'Interaction locked', 'Muted', expect.stringMatching(/^Emulated: /u), '2 temporary network routes'])
    expect(words(card('busy'))).not.toContain('Group:')
  })

  it('searches labels, titles, addresses and workspace names with every word, and says when nothing matches', async () => {
    const tabs = mountTabs()
    await tabs.showTabs()
    const search = byId<HTMLInputElement>('tab-search')
    search.value = 'acme qa'
    search.dispatchEvent(new Event('input'))
    expect([...document.querySelectorAll('[data-result-key]')].map(node => (node as HTMLElement).dataset.resultKey)).toEqual(['open:cart'])
    expect(words(byId('tab-search-status'))).toBe('1 matching item. Selected Checkout QA.')
    search.value = 'news.example.org'
    search.dispatchEvent(new Event('input'))
    expect([...document.querySelectorAll('[data-result-key]')].map(node => (node as HTMLElement).dataset.resultKey)).toEqual(['open:news'])
    search.value = 'wiki'
    search.dispatchEvent(new Event('input'))
    expect([...document.querySelectorAll('[data-result-key]')].map(node => (node as HTMLElement).dataset.resultKey)).toEqual(['saved:old'])
    search.value = 'nothing here'
    search.dispatchEvent(new Event('input'))
    expect([...query('.tabs-empty').children].map(words).filter(Boolean)).toEqual(['No matching tabs', 'Try another title or address.'])
    // A search field takes no aria-expanded; with nothing found, it names no result as active.
    expect(search.hasAttribute('aria-expanded')).toBe(false)
    expect(search.hasAttribute('aria-activedescendant')).toBe(false)
  })

  it('shows one result type at a time, with arrow keys between the types', async () => {
    const tabs = mountTabs()
    await tabs.showTabs()
    byId('tab-kind-closed').click()
    expect(sectionTitles()).toEqual(['Recently closed1'])
    expect(byId('tab-results').getAttribute('aria-labelledby')).toBe('tab-kind-closed')
    key(byId('tab-kind-closed'), 'ArrowRight')
    expect(document.activeElement).toBe(byId('tab-kind-saved'))
    expect(sectionTitles()).toEqual(['Archived workspaces1'])
    key(byId('tab-kind-saved'), 'Home')
    expect(sectionTitles()).toHaveLength(4)
  })

  it('moves the selection with Up and Down, opens it with Enter once per press, and goes back with Escape', async () => {
    const tabs = mountTabs()
    await tabs.showTabs()
    const search = byId('tab-search')
    key(search, 'ArrowDown')
    expect(search.getAttribute('aria-activedescendant')).toBe('tab-result-open-news')
    key(search, 'ArrowUp')
    key(search, 'ArrowUp')
    expect(search.getAttribute('aria-activedescendant')).toBe('tab-result-open-cart')
    key(search, 'Enter', { repeat: true })
    expect(tabs.tabAction).not.toHaveBeenCalled()
    key(search, 'Enter')
    await flush()
    expect(tabs.tabAction).toHaveBeenLastCalledWith({ kind: 'open', tabId: 'cart' })
    const escape = key(search, 'Escape')
    await flush()
    expect(escape.defaultPrevented).toBe(true)
    expect(tabs.tabAction).toHaveBeenLastCalledWith({ kind: 'back' })
  })

  it('reopens a closed tab and restores an archived workspace from their rows', async () => {
    const tabs = mountTabs()
    await tabs.showTabs()
    query<HTMLButtonElement>('[data-result-key="closed:closed-1"] .tab-row-open').click()
    await flush()
    expect(tabs.tabAction).toHaveBeenLastCalledWith({ kind: 'reopen', closedTabId: 'closed-1' })
    query<HTMLButtonElement>('[data-result-key="saved:old"] [data-tab-action="restore"].tab-row-action').click()
    await flush()
    expect(tabs.tabAction).toHaveBeenLastCalledWith({ kind: 'restore', workspaceId: 'old' })
  })

  it('closes a tab with its × button and gives the search field the focus that button had', async () => {
    const tabs = mountTabs()
    await tabs.showTabs()
    const close = query<HTMLButtonElement>('.tab-card-close', card('news'))
    expect(close.getAttribute('aria-label')).toBe('Close News')
    tabs.set(tabsState({ tabs: tabsState().tabs.filter(candidate => candidate.id !== 'news') }))
    close.focus()
    close.click()
    await flush()
    expect(tabs.tabAction).toHaveBeenLastCalledWith({ kind: 'close', tabId: 'news' })
    expect(document.querySelector('[data-result-key="open:news"]')).toBeNull()
    expect(document.activeElement).toBe(byId('tab-search'))
  })

  it('pins from the card menu, which closes and keeps the focus on its button', async () => {
    const tabs = mountTabs()
    await tabs.showTabs()
    const menu = query<HTMLDetailsElement>('.card-menu', card('docs'))
    menu.open = true
    tabs.set(tabsState({ tabs: tabsState().tabs.map(candidate => candidate.id === 'docs' ? { ...candidate, pinned: true } : candidate) }))
    query<HTMLButtonElement>('[data-tab-action="pin"]', card('docs')).click()
    await flush()
    expect(tabs.tabAction).toHaveBeenLastCalledWith({ kind: 'pin', tabId: 'docs', pinned: true })
    expect(query<HTMLDetailsElement>('.card-menu', card('docs')).open).toBe(false)
    expect(document.activeElement).toBe(query('summary', card('docs')))
    expect(words(query('[data-tab-action="pin"]', card('docs')))).toBe('Unpin tab')
  })

  it('closes an open card menu on Escape without going back to the page', async () => {
    const tabs = mountTabs()
    await tabs.showTabs()
    const menu = query<HTMLDetailsElement>('.card-menu', card('docs'))
    menu.open = true
    query<HTMLButtonElement>('[data-tab-action="pin"]', card('docs')).focus()
    key(document.activeElement!, 'Escape')
    await flush()
    expect(menu.open).toBe(false)
    expect(tabs.tabAction).not.toHaveBeenCalled()
  })

  it('edits a label in place: checks it, saves it in main, and warns while it may not be on disk', async () => {
    const tabs = mountTabs()
    await tabs.showTabs()
    query<HTMLButtonElement>('[data-tab-action="label"]', card('docs')).click()
    const input = query<HTMLInputElement>('.tab-label-form input', card('docs'))
    expect(document.activeElement).toBe(input)
    input.value = 'Bad\u0007label'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    query('.tab-label-form', card('docs')).dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await flush()
    expect(words(query('.tab-label-form [role="alert"]', card('docs')))).toBe('Use at most 100 characters without control characters.')
    expect(tabs.tabAction).not.toHaveBeenCalled()
    const field = query<HTMLInputElement>('.tab-label-form input', card('docs'))
    field.value = 'Docs QA'
    field.dispatchEvent(new Event('input', { bubbles: true }))
    tabs.set(tabsState({ tabs: tabsState().tabs.map(candidate => candidate.id === 'docs' ? { ...candidate, label: 'Docs QA', labelDurabilityUnconfirmed: true } : candidate) }))
    query('.tab-label-form', card('docs')).dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await flush()
    expect(tabs.tabAction).toHaveBeenLastCalledWith({ kind: 'label', tabId: 'docs', label: 'Docs QA' })
    expect(words(query('.tab-label-form [role="alert"]', card('docs')))).toMatch(/^The label changed, but disk durability could not be confirmed/u)
    key(query('.tab-label-form input', card('docs')), 'Escape')
    await flush()
    expect(card('docs').querySelector('.tab-label-form')).toBeNull()
    expect(words(query('.tab-card-label [role="alert"]', card('docs')))).toMatch(/^The label changed/u)
    expect(document.activeElement).toBe(query('summary', card('docs')))
    expect(tabs.tabAction).toHaveBeenCalledTimes(1)
  })

  it('says a label was not saved when main fails, and keeps the form open', async () => {
    const tabs = mountTabs()
    await tabs.showTabs()
    tabs.tabAction.mockRejectedValueOnce(new Error('disk full'))
    query<HTMLButtonElement>('[data-tab-action="label"]', card('docs')).click()
    query('.tab-label-form', card('docs')).dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await flush()
    expect(words(query('.tab-label-form [role="alert"]', card('docs')))).toBe('Label was not saved. The previous label is unchanged. Try again.')
    expect(byId('tabs-error').hidden).toBe(true)
  })

  it('asks before deleting an archived workspace, and keeps a protected one or a locked browser from deletion', async () => {
    const confirm = vi.fn(async () => false)
    const tabs = mountTabs(tabsState(), { confirm })
    await tabs.showTabs()
    const remove = (): HTMLButtonElement => query('[data-result-key="saved:old"] [data-tab-action="delete"]')
    remove().click()
    await flush()
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('Old project') }))
    expect(tabs.tabAction).not.toHaveBeenCalled()
    confirm.mockResolvedValueOnce(true)
    remove().click()
    await flush()
    expect(tabs.tabAction).toHaveBeenLastCalledWith({ kind: 'delete', workspaceId: 'old' })
    tabs.set(tabsState({ archivedWorkspaces: [{ ...tabsState().archivedWorkspaces[0]!, deletionProtected: true }] }))
    await tabs.showTabs()
    expect(remove().disabled).toBe(true)
    tabs.set(tabsState({ locked: true }))
    await tabs.showTabs()
    expect(remove().disabled).toBe(true)
  })

  it('shows a failed action in the interface language, with main’s reason', async () => {
    const tabs = mountTabs()
    await tabs.showTabs()
    tabs.tabAction.mockRejectedValueOnce(new Error("Error invoking remote method 'hronaut-home:tab-action': Error: The tab is no longer available."))
    query<HTMLButtonElement>('.tab-card-open', card('news')).click()
    await flush()
    expect(byId('tabs-error').hidden).toBe(false)
    expect(words(byId('tabs-error'))).toBe('Open tab failed The tab is no longer available.')
  })

  it('shows the frame main kept of a tab, takes a newer one of the same page, and drops it once the tab navigates', async () => {
    const pictured = (revisions: Record<string, number>, changes: Partial<HomeTab> = {}): HomeTabsState => tabsState({
      tabs: tabsState().tabs.map(candidate => {
        const previewRevision = revisions[candidate.id]
        return { ...candidate, ...(candidate.id === 'docs' ? changes : {}), ...(previewRevision === undefined ? {} : { previewRevision }) }
      })
    })
    const tabs = mountTabs(pictured({ cart: 1, docs: 2, news: 3 }))
    tabs.getTabPreviews.mockResolvedValueOnce([
      { tabId: 'docs', navigationGeneration: 1, revision: 2, dataUrl: FRAME, width: 320, height: 200 },
      { tabId: 'news', navigationGeneration: 9, revision: 3, dataUrl: FRAME, width: 320, height: 200 },
      { tabId: 'cart', navigationGeneration: 1, revision: 1, dataUrl: 'javascript:alert(1)', width: 320, height: 200 }
    ])
    await tabs.showTabs()
    expect(tabs.getTabPreviews).toHaveBeenCalledWith(['cart', 'docs', 'news'])
    expect(query<HTMLImageElement>('.tab-card-preview img', card('docs')).src).toBe(FRAME)
    expect(card('news').querySelector('.tab-card-preview img')).toBeNull()
    expect(card('cart').querySelector('.tab-card-preview img')).toBeNull()
    expect([...query('.tab-card-placeholder', card('news')).children].slice(1).map(words)).toEqual(['news.example.org', 'No preview yet'])
    // The person typed or scrolled in Docs since: main pictured the same page again, and the next visit shows that.
    const newer = 'data:image/jpeg;base64,BBBB'
    tabs.getTabPreviews.mockResolvedValueOnce([{ tabId: 'docs', navigationGeneration: 1, revision: 4, dataUrl: newer, width: 320, height: 200 }])
    tabs.set(pictured({ cart: 1, docs: 4, news: 3 }))
    await tabs.showTabs()
    expect(tabs.getTabPreviews).toHaveBeenLastCalledWith(['cart', 'docs', 'news'])
    expect(query<HTMLImageElement>('.tab-card-preview img', card('docs')).src).toBe(newer)
    // Docs navigated, and main keeps no frame of the new page: its picture goes, and Home asks only for frames main has.
    tabs.set(pictured({ cart: 1, news: 3 }, { navigationGeneration: 2 }))
    await tabs.showTabs()
    expect(card('docs').querySelector('.tab-card-preview img')).toBeNull()
    expect(tabs.getTabPreviews).toHaveBeenLastCalledWith(['cart', 'news'])
  })

  it('reads the tabs again when Home comes into view, and not while it is hidden', async () => {
    let tabsChanged: (() => void) | undefined
    const tabs = mountTabs(tabsState(), { onTabsChanged: listener => { tabsChanged = listener; return () => { tabsChanged = undefined } } })
    await tabs.showTabs()
    let hidden = false
    const visibility = vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden)
    try {
      // Tab X closes in the strip while Home is out of view; the notice is not read then.
      hidden = true
      document.dispatchEvent(new Event('visibilitychange'))
      tabs.set(tabsState({ tabs: tabsState().tabs.filter(candidate => candidate.id !== 'news') }))
      const reads = tabs.getTabs.mock.calls.length
      tabsChanged!()
      await vi.advanceTimersByTimeAsync(300)
      expect(tabs.getTabs.mock.calls.length).toBe(reads)
      // Choosing Home's tab in the strip shows it: the Tabs view reads at once, without a stale card for X.
      hidden = false
      document.dispatchEvent(new Event('visibilitychange'))
      await flush()
      expect(tabs.getTabs.mock.calls.length).toBe(reads + 1)
      expect(document.querySelector('[data-result-key="open:news"]')).toBeNull()
    } finally {
      visibility.mockRestore()
    }
  })

  it('drops a read that began before an action, so the action’s answer stands', async () => {
    const tabs = mountTabs()
    await tabs.showTabs()
    const late = deferred<HomeTabsState>()
    tabs.getTabs.mockReturnValueOnce(late.promise)
    byId('home-tab-workspaces').click()
    byId('home-tab-tabs').click()
    tabs.set(tabsState({ tabs: [tab('docs', { title: 'Docs' })] }))
    query<HTMLButtonElement>('.tab-card-close', card('news')).click()
    await flush()
    late.resolve(tabsState())
    await flush()
    expect(document.querySelector('[data-result-key="open:news"]')).toBeNull()
  })

  it('opens the full-page preview with Alt+Enter, and Escape returns to the tabs instead of the page', async () => {
    const capture = deferred<BrowserTabOverviewPreview>()
    const getTabPagePreview = vi.fn(() => capture.promise)
    const tabs = mountTabs(tabsState(), { getTabPagePreview })
    await tabs.showTabs()
    key(byId('tab-search'), 'Enter', { altKey: true })
    expect(getTabPagePreview).toHaveBeenCalledWith('docs')
    expect(byId('tabs-browse').hidden).toBe(true)
    expect(byId('tab-page-preview').hidden).toBe(false)
    expect(words(query('.tab-page-preview-state'))).toBe('Capturing the full page…')
    capture.resolve({ tabId: 'docs', navigationGeneration: 1, dataUrl: FRAME, width: 800, height: 2400 })
    await flush()
    expect(query<HTMLImageElement>('.tab-page-preview-canvas img').alt).toBe('Full-page preview of Docs')
    query<HTMLButtonElement>('[data-preview-action="fit-width"]').click()
    expect(query('.tab-page-preview-canvas').classList.contains('fit-width')).toBe(true)
    key(query('.tab-page-preview-canvas'), 'Escape')
    await flush()
    expect(byId('tab-page-preview').hidden).toBe(true)
    expect(byId('tabs-browse').hidden).toBe(false)
    expect(document.activeElement).toBe(byId('tab-search'))
    expect(tabs.tabAction).not.toHaveBeenCalled()
  })

  it('says a full-page picture is out of date when the tab navigates while it shows', async () => {
    const getTabPagePreview = vi.fn(async () => ({ tabId: 'docs', navigationGeneration: 1, dataUrl: FRAME, width: 800, height: 2400 }))
    const tabs = mountTabs(tabsState(), { getTabPagePreview })
    await tabs.showTabs()
    query<HTMLButtonElement>('[data-tab-action="preview"]', card('docs')).click()
    await flush()
    expect(document.querySelector('.tab-page-preview-canvas img')).not.toBeNull()
    tabs.set(tabsState({ tabs: tabsState().tabs.map(candidate => candidate.id === 'docs' ? { ...candidate, navigationGeneration: 2 } : candidate) }))
    byId('home-tab-workspaces').click()
    byId('home-tab-tabs').click()
    await flush()
    expect(byId('tab-page-preview').hidden).toBe(true)
    query<HTMLButtonElement>('[data-tab-action="preview"]', card('docs')).click()
    await flush()
    tabs.set(tabsState({ tabs: tabsState().tabs.map(candidate => candidate.id === 'docs' ? { ...candidate, navigationGeneration: 3 } : candidate) }))
    await vi.advanceTimersByTimeAsync(2100)
    expect(words(query('.tab-page-preview-state strong'))).toBe('The page changed')
  })

  it('says when no website tab is open', async () => {
    const tabs = mountTabs(tabsState({ tabs: [], closedTabs: [], archivedWorkspaces: [], previousTabId: null }))
    await tabs.showTabs()
    expect(words(query('.tabs-empty'))).toBe('No website tabs open')
    expect(byId('tabs-hint-back').hidden).toBe(true)
    byId('tabs-new-tab').click()
    await flush()
    expect(tabs.tabAction).toHaveBeenLastCalledWith({ kind: 'new-tab' })
  })
})
