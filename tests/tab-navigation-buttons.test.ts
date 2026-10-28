import { describe, expect, it, vi } from 'vitest'
vi.mock('electron', () => ({ session: {}, WebContentsView: class {}, nativeImage: {}, shell: {}, app: { getPath: () => '/tmp' }, powerMonitor: { on: () => undefined } }))
import { BrowserTabsManager } from '../src/main/browser/tabs-manager.js'
import { SLEEPING_PAGE_URL } from '../src/main/browser/tab-sleep/sleeping-page.js'
import { withoutSleepingPage } from '../src/main/browser/tab-sleep/tab-sleep.js'

// The browser state is built many times a second while pages load, and it read every tab's whole history, page by page,
// to say whether Back and Forward work; the saved history of each tab was also read again every few seconds.

interface Manager {
  navigationButtons(tab: unknown): { canGoBack: boolean; canGoForward: boolean }
  savedTabHistoryAccess(everyTab: boolean): { unchanged(tab: unknown): boolean }
}

function liveTab(urls: string[], index: number, options: { destroyed?: boolean; throws?: boolean } = {}) {
  const getEntryAtIndex = vi.fn((at: number) => (at in urls ? { url: urls[at], title: '' } : null))
  return {
    id: 'tab', url: urls[index] ?? '', title: 'Title',
    webContents: {
      isDestroyed: () => options.destroyed === true,
      navigationHistory: {
        length: () => { if (options.throws) throw new Error('Object has been destroyed'); return urls.length },
        getActiveIndex: () => index,
        getEntryAtIndex,
        getAllEntries: vi.fn(() => urls.map(url => ({ url, title: '' })))
      }
    }
  }
}

function manager(fields: Record<string, unknown> = {}): Manager {
  return Object.assign(Object.create(BrowserTabsManager.prototype), { activeTabId: null, splitView: null, ...fields }) as Manager
}

const PAGE = 'https://example.test/'
const SLEEP = SLEEPING_PAGE_URL

describe('Back and Forward of a tab in the browser state', () => {
  it('match its history without the sleeping page, without reading its pages\' list', () => {
    const histories: Array<[string[], number]> = [
      [[], -1], [[PAGE], 0], [[PAGE + 'a', PAGE + 'b'], 0], [[PAGE + 'a', PAGE + 'b'], 1],
      [[PAGE + 'a', SLEEP], 1], [[SLEEP, PAGE + 'a'], 1], [[PAGE + 'a', SLEEP, PAGE + 'b'], 0],
      [[PAGE + 'a', SLEEP, PAGE + 'b'], 2], [[PAGE + 'a', SLEEP, PAGE + 'b'], 1], [[SLEEP, PAGE + 'a', SLEEP], 1],
      [[PAGE + 'a', PAGE + 'b', SLEEP, PAGE + 'c'], 1]
    ]
    for (const [urls, index] of histories) {
      const tab = liveTab(urls, index)
      const expected = withoutSleepingPage({ entries: urls.map(url => ({ url, title: '' })), index })
      expect(manager().navigationButtons(tab), `${urls.join(' ')} at ${index}`).toEqual({
        canGoBack: expected.index > 0,
        canGoForward: expected.index >= 0 && expected.index < expected.entries.length - 1
      })
      expect(tab.webContents.navigationHistory.getAllEntries).not.toHaveBeenCalled()
    }
  })

  it('come from the history a sleeping tab keeps', () => {
    const tab = { ...liveTab([SLEEP], 0), sleepNavigationHistory: { entries: [{ url: PAGE + 'a', title: '' }, { url: PAGE + 'b', title: '' }], index: 1 } }
    expect(manager().navigationButtons(tab)).toEqual({ canGoBack: true, canGoForward: false })
  })

  it('are off for a page that is gone, or goes while it is read', () => {
    expect(manager().navigationButtons(liveTab([PAGE + 'a', PAGE + 'b'], 1, { destroyed: true }))).toEqual({ canGoBack: false, canGoForward: false })
    expect(manager().navigationButtons(liveTab([PAGE + 'a', PAGE + 'b'], 1, { throws: true }))).toEqual({ canGoBack: false, canGoForward: false })
  })
})

describe('saving a tab\'s history for the next start', () => {
  it('reads a tab behind the one shown again only once its history moved', () => {
    const access = manager({ activeTabId: 'other' }).savedTabHistoryAccess(false)
    const tab = liveTab([PAGE + 'a', PAGE + 'b'], 1)
    expect(access.unchanged(tab)).toBe(false)
    expect(access.unchanged(tab)).toBe(true)
    tab.webContents.navigationHistory.getActiveIndex = () => 0
    tab.url = PAGE + 'a'
    expect(access.unchanged(tab)).toBe(false)
    expect(access.unchanged(tab)).toBe(true)
    tab.title = 'Renamed'
    expect(access.unchanged(tab)).toBe(false)
  })

  it('reads the tabs shown each time, for their scroll and form state, and every tab when the browser closes', () => {
    const shown = liveTab([PAGE + 'a'], 0)
    const access = manager({ activeTabId: shown.id }).savedTabHistoryAccess(false)
    access.unchanged(shown)
    expect(access.unchanged(shown)).toBe(false)
    const split = manager({ activeTabId: 'other', splitView: { firstTabId: 'other', secondTabId: shown.id } }).savedTabHistoryAccess(false)
    split.unchanged(shown)
    expect(split.unchanged(shown)).toBe(false)
    const behind = liveTab([PAGE + 'b'], 0)
    const closing = manager({ activeTabId: 'other' }).savedTabHistoryAccess(true)
    closing.unchanged(behind)
    expect(closing.unchanged(behind)).toBe(false)
  })

  it('reads a page that is gone again', () => {
    const access = manager({ activeTabId: 'other' }).savedTabHistoryAccess(false)
    const tab = liveTab([PAGE + 'a'], 0, { destroyed: true })
    access.unchanged(tab)
    expect(access.unchanged(tab)).toBe(false)
  })
})
