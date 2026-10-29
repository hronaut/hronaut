import { describe, expect, it, vi } from 'vitest'
import { Browser } from '../src/main/browser/browser.js'
import { forgetTabHistoryPages, holdTabHistory, type TabHistoryPagesTab } from '../src/main/browser/tab-history-pages/forget-tab-history-pages.js'
import type { BrowserClosedTabState } from '../src/shared/types.js'

vi.mock('electron', () => ({
  session: {}, WebContentsView: class {}, nativeImage: {}, shell: {}, app: { getPath: () => '/tmp' }, powerMonitor: { on: () => undefined }
}))

const SLEEPING_PAGE = 'data:text/html;charset=utf-8,%3C!doctype%20html%3E%3Cmeta%20charset%3D%22utf-8%22%3E%3Ctitle%3ESleeping%20tab%3C%2Ftitle%3E'
const page = (name: string) => `https://example.test/${name}`
const entry = (name: string) => ({ url: page(name), title: name, pageState: '' })

/**
 * A tab's history as Chromium keeps it: the active entry is the one a back or forward load goes to, and Chromium never
 * lets go of it or of the page the tab committed last, while it loads another.
 */
function tab(urls: string[], active: number, options: Partial<TabHistoryPagesTab> & { committed?: number; destroyed?: boolean; mcpGroupId?: string } = {}) {
  const entries = urls.map((url) => ({ url, title: url, pageState: '' }))
  let activeIndex = active
  let committedIndex = options.committed ?? active
  const history = {
    length: () => entries.length,
    getActiveIndex: () => activeIndex,
    getEntryAtIndex: (index: number) => entries[index] ?? null,
    removeEntryAtIndex: (index: number) => {
      if (index === activeIndex || index === committedIndex || !entries[index]) return false
      entries.splice(index, 1)
      if (index < activeIndex) activeIndex -= 1
      if (index < committedIndex) committedIndex -= 1
      return true
    }
  }
  const opened: TabHistoryPagesTab & { mcpGroupId?: string } = {
    ...options,
    webContents: { isDestroyed: () => options.destroyed === true, navigationHistory: history }
  }
  return { tab: opened, urls: () => entries.map((candidate) => candidate.url), active: () => activeIndex }
}

const matching = (...names: string[]) => (url: string) => names.some((name) => url === page(name))

describe('forgetting cleared pages from open tabs\' Back and Forward lists', () => {
  it('forgets the matching back and forward pages and keeps the page the tab shows', () => {
    // Clearing the history left the pages in Back and Forward, with their saved form state, as Chrome forgets them.
    const open = tab(['a', 'b', 'c', 'b', 'd'].map(page), 3)
    expect(forgetTabHistoryPages([open.tab], matching('b', 'd'))).toBe(true)
    expect(open.urls()).toEqual(['a', 'c', 'b'].map(page))
    expect(open.active()).toBe(2)
    expect(forgetTabHistoryPages([open.tab], matching('e'))).toBe(false)
  })

  it('keeps a page Chromium is loading and skips a closing tab', () => {
    const loading = tab(['a', 'b', 'c'].map(page), 2, { committed: 0 })
    const closing = tab(['a', 'b'].map(page), 1, { destroyed: true })
    expect(forgetTabHistoryPages([loading.tab, closing.tab], () => true)).toBe(true)
    expect(loading.urls()).toEqual(['a', 'c'].map(page))
    expect(closing.urls()).toEqual(['a', 'b'].map(page))
  })

  it('goes on with the other tabs when a page goes away while its history is read', () => {
    const gone = tab(['a', 'b'].map(page), 1)
    gone.tab.webContents.navigationHistory.length = () => { throw new Error('Object has been destroyed') }
    const open = tab(['a', 'b'].map(page), 1)
    expect(forgetTabHistoryPages([gone.tab, open.tab], () => true)).toBe(true)
    expect(open.urls()).toEqual([page('b')])
  })

  it('forgets them from the history a sleeping tab wakes with, keeping the page it slept on', () => {
    const sleepNavigationHistory = { entries: ['a', 'b', 'c'].map(entry), index: 1 }
    const asleep = tab([page('a'), page('b'), SLEEPING_PAGE], 2, { sleepNavigationHistory })
    expect(forgetTabHistoryPages([asleep.tab], () => true)).toBe(true)
    expect(asleep.tab.sleepNavigationHistory).toEqual({ entries: [entry('b')], index: 0 })
    // It goes back from the sleeping page to its own page when it wakes.
    expect(asleep.urls()).toEqual([page('b'), SLEEPING_PAGE])
  })

  it('forgets the page before the one a waking tab goes back to', () => {
    // While a tab woke, the page before its own stayed, as the tab was taken to show the sleeping page; Back then
    // still led to a page whose history was cleared.
    const waking = tab([page('a'), page('b'), SLEEPING_PAGE], 1, { committed: 2 })
    forgetTabHistoryPages([waking.tab], () => true)
    expect(waking.urls()).toEqual([page('b'), SLEEPING_PAGE])
  })

  it('keeps the page a tab goes back to when its wake loads its address while it shows the sleeping page', () => {
    const waking = tab([page('a'), page('b'), SLEEPING_PAGE], 2)
    forgetTabHistoryPages([waking.tab], () => true)
    expect(waking.urls()).toEqual([page('b'), SLEEPING_PAGE])
  })

  it('forgets them from a history held while something is waited for', () => {
    // A tab whose wake failed went back to sleep with the history taken before the wake, cleared pages included.
    const held = holdTabHistory({ entries: ['a', 'b', 'c'].map(entry), index: 1 })
    forgetTabHistoryPages([], matching('a', 'b'))
    expect(held).toEqual({ entries: [entry('b'), entry('c')], index: 0 })
  })

  it('publishes the tabs when only an open tab forgets a page, without saving them', () => {
    const changed = vi.fn()
    const open = tab(['a', 'b'].map(page), 1)
    const manager = Object.assign(Object.create(Browser.prototype), {
      closedTabs: [], detachedClosedTabs: new Set(), tabs: new Map([['tab', open.tab]]), changed
    }) as Browser
    manager.forgetHistoryPages(matching('c'))
    expect(changed).not.toHaveBeenCalled()
    manager.forgetHistoryPages(matching('a'))
    expect(open.urls()).toEqual([page('b')])
    expect(changed).toHaveBeenCalledExactlyOnceWith(false)
  })

  it('forgets them only in the workspace an agent clears a website\'s history from', () => {
    const agentTab = tab(['a', 'b'].map(page), 1, { mcpGroupId: 'agent-workspace' })
    const personTab = tab(['a', 'b'].map(page), 1, { mcpGroupId: 'person-workspace' })
    const closed = (mcpGroupId: string): BrowserClosedTabState => ({
      id: mcpGroupId, title: 'a', url: page('a'), pinned: false, closedAt: '2026-10-24T16:00:00.000Z', mcpGroupId
    })
    const internals = {
      closedTabs: [closed('agent-workspace'), closed('person-workspace')],
      detachedClosedTabs: new Set(),
      tabs: new Map([['agent', agentTab.tab], ['person', personTab.tab]]),
      changed: vi.fn()
    }
    const manager = Object.assign(Object.create(Browser.prototype), internals) as Browser
    manager.forgetHistoryPages(matching('a'), 'agent-workspace')
    expect(agentTab.urls()).toEqual([page('b')])
    expect(personTab.urls()).toEqual(['a', 'b'].map(page))
    expect(internals.closedTabs.map((tab) => tab.mcpGroupId)).toEqual(['person-workspace'])
  })
})
