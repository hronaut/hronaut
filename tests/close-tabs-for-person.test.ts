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

  it('names a closed tab by its label first', async () => {
    const { access, offers } = manager([{ id: 'blank', title: 'New tab', label: 'Checkout task', url: 'about:blank', pinned: false }])
    await closeTabsForPerson(access, ['blank'])
    expect(offers).toMatchObject([{ kind: 'tabs-closed', name: 'Checkout task', count: 1 }])
  })
})
