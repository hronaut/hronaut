import { describe, expect, it, vi } from 'vitest'
// The browser below stubs getState, reopenClosedTabEntry and reorderTab, which closing tabs and their Undo reach through these.
vi.mock('../src/main/browser/browser-state/browser-state.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/main/browser/browser-state/browser-state.js')>(),
  browserState: (browser: { getState: () => unknown }) => browser.getState()
}))
vi.mock('../src/main/browser/tab-reopening/tab-reopening.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/main/browser/tab-reopening/tab-reopening.js')>(),
  reopenClosedTabEntry: (browser: { reopenClosedTabEntry: (...args: unknown[]) => unknown }, ...args: unknown[]) => browser.reopenClosedTabEntry(...args)
}))
vi.mock('../src/main/browser/tab-arrangement/tab-arrangement.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/main/browser/tab-arrangement/tab-arrangement.js')>(),
  reorderTab: (browser: { reorderTab: (...args: unknown[]) => unknown }, ...args: unknown[]) => browser.reorderTab(...args)
}))
import { closeTabsForPerson } from '../src/main/browser/tab-close/close-tabs-for-person.js'
import type { UndoableAction } from '../src/main/undo-offers.js'
import type { BrowserClosedTabState, BrowserState } from '../src/shared/types.js'

type Tab = { id: string; url: string; mcpGroupId?: string; pinned: boolean; title: string; label?: string; sleeping?: boolean }

/**
 * A browser with these tabs open, in a Ukrainian interface. Closing the shown tab shows the tab after it, or the
 * one before it when it was last, waking it when it sleeps, as the browser does; a tab listed as staying asks to
 * stay and is kept.
 */
function openBrowser(tabs: Tab[], options: { active?: string; staying?: string[] } = {}) {
  const open = [...tabs]
  const closed: BrowserClosedTabState[] = []
  const offers: UndoableAction[] = []
  const woken: string[] = []
  let active = options.active ?? null
  const state = {} as BrowserState
  const browser = {
    // The open tabs in the order the strip shows them.
    get tabs() { return new Map(open.map(tab => [tab.id, tab])) },
    mcpTabGroups: new Map(),
    get activeTabId() { return active },
    closedTabs: closed,
    closeTabInternal: vi.fn(async (tabId: string) => {
      if (options.staying?.includes(tabId)) return state
      const index = open.findIndex(tab => tab.id === tabId)
      const [tab] = open.splice(index, 1)
      closed.push({ id: `closed-${tabId}`, title: tab!.title, url: tab!.url, pinned: tab!.pinned, closedAt: '2026-10-19T12:00:00Z', ...(tab!.label ? { label: tab!.label } : {}) })
      if (tabId === active) {
        const next = open[index] ?? open[index - 1]
        active = next?.id ?? null
        if (next?.sleeping) { woken.push(next.id); next.sleeping = false }
      }
      return state
    }),
    reopenClosedTabEntry: async (closedTabId: string) => {
      const index = closed.findIndex(entry => entry.id === closedTabId)
      if (index === -1) return undefined
      const [entry] = closed.splice(index, 1)
      const tab: Tab = { id: entry!.id.replace(/^closed-/, ''), title: entry!.title, url: entry!.url, pinned: entry!.pinned }
      open.push(tab)
      return tab
    },
    tabLabelLifecycleHolds: 0,
    pendingTabLabels: new Set(),
    reorderTab: (tabId: string, targetTabId: string, placement: 'before' | 'after') => {
      const [tab] = open.splice(open.findIndex(candidate => candidate.id === tabId), 1)
      const target = open.findIndex(candidate => candidate.id === targetTabId)
      open.splice(placement === 'before' ? target : target + 1, 0, tab!)
      return state
    },
    getState: () => state,
    options: { offerUndo: (action: UndoableAction) => offers.push(action) },
    text: (key: string) => key === 'tabSearch.newTabTitle' ? 'Нова вкладка' : key
  }
  const closedOrder = () => browser.closeTabInternal.mock.calls.map(([tabId]) => tabId)
  return { browser, offers, woken, closedOrder, active: () => active, openIds: () => open.map(tab => tab.id) }
}

/** Website tabs with these IDs, sleeping when the ID says so. */
function sites(...ids: string[]): Tab[] {
  return ids.map(id => ({ id, title: id, url: `https://example.test/${id}`, pinned: false, sleeping: id.startsWith('asleep') }))
}

describe('closing tabs for the person', () => {
  it('names a closed blank tab in the interface language on its Undo offer', async () => {
    // Hronaut calls a blank tab "New tab" until a page names it; the Undo toast showed that English title in every language.
    const { browser, offers } = openBrowser([
      { id: 'blank', title: 'New tab', url: 'about:blank', pinned: false },
      { id: 'site', title: 'New tab', url: 'https://example.test/new', pinned: false }
    ])
    await closeTabsForPerson(browser as never, ['blank'])
    expect(offers.map(offer => offer.name)).toEqual(['Нова вкладка'])
    // A website that calls itself "New tab" keeps its own title.
    await closeTabsForPerson(browser as never, ['site'])
    expect(offers.map(offer => offer.name)).toEqual(['Нова вкладка', 'New tab'])
  })

  it('closes the shown tab last, so no sleeping tab wakes only to be closed next', async () => {
    const tabs = openBrowser(sites('shown', 'asleep-1', 'asleep-2', 'kept'), { active: 'shown' })

    // Close other tabs on the last tab passes the others in order, the shown one first.
    await closeTabsForPerson(tabs.browser as never, ['shown', 'asleep-1', 'asleep-2'])

    // The shown tab used to close first, so each sleeping tab after it was shown, and woke, before it closed.
    expect(tabs.closedOrder()).toEqual(['asleep-1', 'asleep-2', 'shown'])
    expect(tabs.woken).toEqual([])
    expect(tabs.openIds()).toEqual(['kept'])
    expect(tabs.active()).toBe('kept')
    expect(tabs.offers).toMatchObject([{ kind: 'tabs-closed', count: 3, name: 'shown' }])
  })

  it('closes tabs in their order when the shown tab is not among them', async () => {
    const tabs = openBrowser(sites('a', 'asleep-b', 'c', 'shown'), { active: 'shown' })

    await closeTabsForPerson(tabs.browser as never, ['a', 'asleep-b', 'c'])

    expect(tabs.closedOrder()).toEqual(['a', 'asleep-b', 'c'])
    expect(tabs.active()).toBe('shown')
  })

  it('stops at a page that asks to stay, which leaves the shown tab open too', async () => {
    const tabs = openBrowser(sites('shown', 'a', 'stays', 'kept'), { active: 'shown', staying: ['stays'] })

    await closeTabsForPerson(tabs.browser as never, ['shown', 'a', 'stays'])

    expect(tabs.openIds()).toEqual(['shown', 'stays', 'kept'])
    expect(tabs.active()).toBe('shown')
    expect(tabs.offers).toMatchObject([{ kind: 'tabs-closed', count: 1, name: 'a' }])
  })

  it('puts every tab back in its place on Undo when the shown tab in the middle closed last', async () => {
    const tabs = openBrowser(sites('x1', 'shown', 'x2', 'kept'), { active: 'shown' })

    await closeTabsForPerson(tabs.browser as never, ['x1', 'shown', 'x2'])
    expect(tabs.closedOrder()).toEqual(['x1', 'x2', 'shown'])
    await tabs.offers[0]!.undo()

    expect(tabs.openIds()).toEqual(['x1', 'shown', 'x2', 'kept'])
  })

  it('names a closed tab by its label first', async () => {
    const { browser, offers } = openBrowser([{ id: 'blank', title: 'New tab', label: 'Checkout task', url: 'about:blank', pinned: false }])
    await closeTabsForPerson(browser as never, ['blank'])
    expect(offers).toMatchObject([{ kind: 'tabs-closed', name: 'Checkout task', count: 1 }])
  })
})
