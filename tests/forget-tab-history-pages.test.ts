import { describe, expect, it, vi } from 'vitest'
import { BrowserTabsManager } from '../src/main/browser/tabs-manager.js'
import { forgetTabHistoryPages, type TabHistoryPagesTab } from '../src/main/browser/tab-history-pages/forget-tab-history-pages.js'

vi.mock('electron', () => ({
  session: {}, WebContentsView: class {}, nativeImage: {}, shell: {}, app: { getPath: () => '/tmp' }, powerMonitor: { on: () => undefined }
}))

const SLEEPING_PAGE = 'data:text/html;charset=utf-8,%3C!doctype%20html%3E%3Cmeta%20charset%3D%22utf-8%22%3E%3Ctitle%3ESleeping%20tab%3C%2Ftitle%3E'
const page = (name: string) => `https://example.test/${name}`

/** A tab's history as Chromium keeps it, which never lets go of the page it shows or one it is loading. */
function tab(urls: string[], active: number, options: Partial<TabHistoryPagesTab> & { loading?: number; destroyed?: boolean } = {}) {
  const entries = urls.map((url) => ({ url, title: url, pageState: '' }))
  let activeIndex = active
  const history = {
    length: () => entries.length,
    getActiveIndex: () => activeIndex,
    getEntryAtIndex: (index: number) => entries[index] ?? null,
    removeEntryAtIndex: (index: number) => {
      if (index === activeIndex || index === options.loading || !entries[index]) return false
      entries.splice(index, 1)
      if (index < activeIndex) activeIndex -= 1
      return true
    }
  }
  const opened: TabHistoryPagesTab = {
    sleeping: false,
    ...options,
    webContents: { isDestroyed: () => options.destroyed === true, navigationHistory: history }
  }
  return { tab: opened, urls: () => entries.map((entry) => entry.url), active: () => activeIndex }
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
    const loading = tab(['a', 'b', 'c'].map(page), 0, { loading: 2 })
    const closing = tab(['a', 'b'].map(page), 1, { destroyed: true })
    expect(forgetTabHistoryPages([loading.tab, closing.tab], () => true)).toBe(true)
    expect(loading.urls()).toEqual(['a', 'c'].map(page))
    expect(closing.urls()).toEqual(['a', 'b'].map(page))
  })

  it('forgets them from the history a sleeping tab wakes with, keeping the page it slept on', () => {
    const asleep = tab([page('a'), page('b'), SLEEPING_PAGE], 2, {
      sleeping: true,
      sleepNavigationHistory: { entries: ['a', 'b', 'c'].map((name) => ({ url: page(name), title: name, pageState: '' })), index: 1 }
    })
    expect(forgetTabHistoryPages([asleep.tab], () => true)).toBe(true)
    expect(asleep.tab.sleepNavigationHistory).toEqual({ entries: [{ url: page('b'), title: 'b', pageState: '' }], index: 0 })
    // It goes back from the sleeping page to its own page when it wakes.
    expect(asleep.urls()).toEqual([page('b'), SLEEPING_PAGE])
  })

  it('keeps the page a waking tab goes back to', () => {
    const waking = tab([page('a'), page('b'), SLEEPING_PAGE], 2, { wakePromise: new Promise(() => undefined) })
    forgetTabHistoryPages([waking.tab], () => true)
    expect(waking.urls()).toEqual([page('b'), SLEEPING_PAGE])
  })

  it('publishes the tabs when only an open tab forgets a page, without saving them', () => {
    const changed = vi.fn()
    const open = tab(['a', 'b'].map(page), 1)
    const manager = Object.assign(Object.create(BrowserTabsManager.prototype), {
      closedTabs: [], detachedClosedTabs: new Set(), tabs: new Map([['tab', open.tab]]), changed
    }) as BrowserTabsManager
    manager.forgetHistoryPages(matching('c'))
    expect(changed).not.toHaveBeenCalled()
    manager.forgetHistoryPages(matching('a'))
    expect(open.urls()).toEqual([page('b')])
    expect(changed).toHaveBeenCalledExactlyOnceWith(false)
  })
})
