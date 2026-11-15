import { describe, expect, it, vi } from 'vitest'
import type { Browser } from '../src/main/browser/browser.js'
import type { BrowserTab } from '../src/main/browser/browser-tab.js'
import { closeTabLeftEmptyByDownload, opensFromPage } from '../src/main/browser/download-tab-close/download-tab-close.js'
import { rememberClosedTab } from '../src/main/browser/tab-reopening/tab-reopening.js'
import type { BrowserClosedTabState } from '../src/shared/types.js'

type Tab = Pick<BrowserTab, 'id' | 'openedFromPage' | 'leftEmptyByDownload'> & {
  url: string
  destroyed?: boolean
  webContents: { isDestroyed(): boolean; getURL(): string }
}

/** A tab a page opened, whose first page is still the download it turned out to be, beside the tab that opened it. */
function opened(changes: Partial<Tab> = {}): Tab {
  const tab: Tab = {
    id: 'opened',
    openedFromPage: true,
    url: '',
    webContents: { isDestroyed: () => tab.destroyed === true, getURL: () => tab.url },
    ...changes
  }
  return tab
}

/** A window whose pages, by their index, show these tabs, with this many tabs open. */
function window(tabs: Tab[], tabCount = tabs.length + 1, failClosing = false) {
  const closed: Tab[] = []
  const open = new Map(tabs.map((tab) => [tab.id, tab]))
  const closeTab = vi.fn(async (tabId: string) => {
    if (failClosing) throw new Error('The tab could not close.')
    closed.push(open.get(tabId)!)
  })
  const browser = {
    destroyed: false,
    webContentsToTab: new Map(tabs.map((tab, index) => [index, tab.id])),
    tabs: { get: (tabId: string) => open.get(tabId), size: tabCount },
    closeTab
  } as unknown as Browser & { closeTab: typeof closeTab }
  return { browser, closed }
}

const settled = () => new Promise((resolve) => setImmediate(resolve))

describe('closing a tab a download left empty', () => {
  it('closes a tab a page opened whose first page turned out to be a download, as Chrome does', async () => {
    // A target="_blank" link to a file left an empty tab in front, which the person had to close.
    const tab = opened()
    const { browser, closed } = window([tab])
    closeTabLeftEmptyByDownload(browser, 0)
    expect(closed).toEqual([])
    await settled()
    expect(closed).toEqual([tab])
    expect(tab.leftEmptyByDownload).toBe(true)
  })

  it.each([
    ['a tab that shows a page, such as one saving a link or its page', opened({ url: 'https://shop.example/invoice' })],
    ['a tab the person, an agent or a restart opened', opened({ openedFromPage: undefined })],
    ['a tab already closing', opened({ destroyed: true })]
  ])('keeps %s', async (_case, tab) => {
    const { browser, closed } = window([tab])
    closeTabLeftEmptyByDownload(browser, 0)
    await settled()
    expect(closed).toEqual([])
    expect(tab.leftEmptyByDownload).toBeUndefined()
  })

  it('keeps a tab that shows a page by the time the download\'s handler returns', async () => {
    const tab = opened()
    const { browser, closed } = window([tab])
    closeTabLeftEmptyByDownload(browser, 0)
    tab.url = 'https://shop.example/'
    await settled()
    expect(closed).toEqual([])
  })

  it('keeps the window\'s only tab, a download from no tab and a tab that already closed', async () => {
    const only = window([opened()], 1)
    closeTabLeftEmptyByDownload(only.browser, 0)
    const none = window([opened()])
    closeTabLeftEmptyByDownload(none.browser, undefined)
    closeTabLeftEmptyByDownload(none.browser, 1)
    await settled()
    expect([...only.closed, ...none.closed]).toEqual([])
    expect(none.browser.closeTab).not.toHaveBeenCalled()
  })

  it('remembers the tab in Recently closed again when it cannot close', async () => {
    const tab = opened()
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      closeTabLeftEmptyByDownload(window([tab], 2, true).browser, 0)
      await settled()
      await settled()
      expect(tab.leftEmptyByDownload).toBeUndefined()
      expect(error).toHaveBeenCalledOnce()
    } finally {
      error.mockRestore()
    }
  })

  it('marks only tabs a page opened as tabs, with no history of their own', () => {
    expect(opensFromPage({ openedFrom: { window: false } })).toBe(true)
    expect(opensFromPage({ openedFrom: {} })).toBe(true)
    // Chrome opens a popup with its own size or position as a window of its own, whose only tab it never closes.
    expect(opensFromPage({ openedFrom: { window: true } })).toBe(false)
    // A middle-click on Back opens that page with the tab's history, which a download there must not take away.
    expect(opensFromPage({ openedFrom: {}, navigationHistory: { entries: [], index: 0 } })).toBe(false)
    expect(opensFromPage({})).toBe(false)
  })

  it('leaves the tab out of Recently closed, as reopening it would download the file again', () => {
    const closedTabs: BrowserClosedTabState[] = []
    const browser = {
      closedTabs, tabs: new Map(), mcpTabGroups: new Map(), navigationHistorySnapshot: () => ({ entries: [], index: -1 })
    } as unknown as Browser
    const tab = {
      id: 'opened', url: 'https://download.example/report.pdf', title: '', pinned: false, zoomIsolated: false,
      tabMuted: false, tabAgentPaused: false, humanInteractionLocked: false
    } as BrowserTab
    rememberClosedTab(browser, { ...tab, leftEmptyByDownload: true })
    expect(closedTabs).toEqual([])
    rememberClosedTab(browser, tab)
    expect(closedTabs.map((closed) => closed.url)).toEqual(['https://download.example/report.pdf'])
  })
})
