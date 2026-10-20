import { describe, expect, it, vi } from 'vitest'
import { closeTabsForPerson } from '../src/main/browser/tab-close/close-tabs-for-person.js'
import type { PersonTabCloseAccess, PersonTabCloseTab } from '../src/main/browser/tab-close/close-tabs-for-person-access.js'
import type { UndoableAction } from '../src/main/undo-offers.js'
import type { BrowserClosedTabState, BrowserState } from '../src/shared/types.js'

type Tab = PersonTabCloseTab & { title: string; label?: string }

/** A tab manager with these tabs open, whose closes always go through, in a Ukrainian interface. */
function manager(tabs: Tab[]) {
  const open = new Map(tabs.map(tab => [tab.id, tab]))
  const closed: BrowserClosedTabState[] = []
  const offers: UndoableAction[] = []
  const state = {} as BrowserState
  const access = {
    getTab: (tabId?: string) => open.get(tabId ?? '')!,
    findTab: (tabId: string) => open.get(tabId),
    orderedTabs: () => [...open.values()],
    activeTabId: () => null,
    closedTabs: () => closed,
    closeTabInternal: vi.fn(async (tabId: string) => {
      const tab = open.get(tabId)!
      open.delete(tabId)
      closed.push({ id: `closed-${tabId}`, title: tab.title, url: tab.url, pinned: tab.pinned, closedAt: '2026-10-19T12:00:00Z', ...(tab.label ? { label: tab.label } : {}) })
      return state
    }),
    getState: () => state,
    options: () => ({ offerUndo: (action: UndoableAction) => offers.push(action) }),
    text: (key: string) => key === 'tabSearch.newTabTitle' ? 'Нова вкладка' : key
  } as unknown as PersonTabCloseAccess<Tab>
  return { access, offers }
}

describe('closing tabs for the person', () => {
  it('names a closed blank tab in the interface language on its Undo offer', async () => {
    // Hronaut calls a blank tab "New tab" until a page names it; the Undo toast showed that English title in every language.
    const { access, offers } = manager([
      { id: 'blank', title: 'New tab', url: 'about:blank', pinned: false },
      { id: 'site', title: 'New tab', url: 'https://example.test/new', pinned: false }
    ])
    await closeTabsForPerson(access, ['blank'])
    expect(offers.map(offer => offer.name)).toEqual(['Нова вкладка'])
    // A website that calls itself "New tab" keeps its own title.
    await closeTabsForPerson(access, ['site'])
    expect(offers.map(offer => offer.name)).toEqual(['Нова вкладка', 'New tab'])
  })

  it('closes the shown tab last, so no sleeping tab wakes only to be closed next', async () => {
    const tabs = ['shown', 'asleep-1', 'asleep-2', 'kept'].map(id => ({ id, title: id, url: `https://example.test/${id}`, pinned: false, sleeping: id.startsWith('asleep') }))
    const { access, offers } = manager(tabs)
    // Closing the shown tab shows the next one, waking it when it sleeps, as the tab manager does.
    let active: string | null = 'shown'
    const woken: string[] = []
    const close = access.closeTabInternal as ReturnType<typeof vi.fn>
    const closeTab = close.getMockImplementation() as (tabId: string, ...rest: unknown[]) => Promise<BrowserState>
    Object.assign(access, { activeTabId: () => active })
    close.mockImplementation(async (tabId: string, ...rest: unknown[]) => {
      const order = access.orderedTabs()
      const next = order[order.findIndex(tab => tab.id === tabId) + 1] ?? order.at(-2)
      const result = await closeTab(tabId, ...rest)
      if (tabId === active) {
        active = next?.id ?? null
        const replacement = tabs.find(tab => tab.id === active)
        if (replacement?.sleeping) { woken.push(replacement.id); replacement.sleeping = false }
      }
      return result
    })

    // Close other tabs on the last tab passes the others in order, the shown one first.
    await closeTabsForPerson(access, ['shown', 'asleep-1', 'asleep-2'])

    expect(access.orderedTabs().map(tab => tab.id)).toEqual(['kept'])
    expect(active).toBe('kept')
    expect(woken).toEqual([])
    expect(offers).toMatchObject([{ kind: 'tabs-closed', count: 3 }])
  })

  it('names a closed tab by its label first', async () => {
    const { access, offers } = manager([{ id: 'blank', title: 'New tab', label: 'Checkout task', url: 'about:blank', pinned: false }])
    await closeTabsForPerson(access, ['blank'])
    expect(offers).toMatchObject([{ kind: 'tabs-closed', name: 'Checkout task', count: 1 }])
  })
})
