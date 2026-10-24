import { describe, expect, it, vi } from 'vitest'
import { closeTabLeftEmptyByDownload, opensFromPage } from '../src/main/browser/download-tab-close/download-tab-close.js'
import type { DownloadTabCloseAccess, DownloadTabCloseTab } from '../src/main/browser/download-tab-close/download-tab-close-access.js'
import { rememberClosedTab } from '../src/main/browser/tab-reopening/tab-reopening.js'
import type { TabReopeningAccess, TabReopeningTab } from '../src/main/browser/tab-reopening/tab-reopening-access.js'
import type { BrowserClosedTabState } from '../src/shared/types.js'

type Tab = DownloadTabCloseTab & { url: string; destroyed?: boolean }

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

function window(tabs: Tab[], tabCount = tabs.length + 1, failClosing = false) {
  const closed: Tab[] = []
  const access: DownloadTabCloseAccess<Tab> = {
    tabOfPage: (webContentsId) => tabs[webContentsId],
    tabCount: () => tabCount,
    closeTab: vi.fn(async (tab: Tab) => {
      if (failClosing) throw new Error('The tab could not close.')
      closed.push(tab)
    })
  }
  return { access, closed }
}

const settled = () => new Promise((resolve) => setImmediate(resolve))

describe('closing a tab a download left empty', () => {
  it('closes a tab a page opened whose first page turned out to be a download, as Chrome does', async () => {
    // A target="_blank" link to a file left an empty tab in front, which the person had to close.
    const tab = opened()
    const { access, closed } = window([tab])
    closeTabLeftEmptyByDownload(access, 0)
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
    const { access, closed } = window([tab])
    closeTabLeftEmptyByDownload(access, 0)
    await settled()
    expect(closed).toEqual([])
    expect(tab.leftEmptyByDownload).toBeUndefined()
  })

  it('keeps a tab that shows a page by the time the download\'s handler returns', async () => {
    const tab = opened()
    const { access, closed } = window([tab])
    closeTabLeftEmptyByDownload(access, 0)
    tab.url = 'https://shop.example/'
    await settled()
    expect(closed).toEqual([])
  })

  it('keeps the window\'s only tab, a download from no tab and a tab that already closed', async () => {
    const only = window([opened()], 1)
    closeTabLeftEmptyByDownload(only.access, 0)
    const none = window([opened()])
    closeTabLeftEmptyByDownload(none.access, undefined)
    closeTabLeftEmptyByDownload(none.access, 1)
    await settled()
    expect([...only.closed, ...none.closed]).toEqual([])
    expect(none.access.closeTab).not.toHaveBeenCalled()
  })

  it('remembers the tab in Recently closed again when it cannot close', async () => {
    const tab = opened()
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      closeTabLeftEmptyByDownload(window([tab], 2, true).access, 0)
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
    const access = {
      closedTabs: () => closedTabs, orderedTabs: () => [], navigationHistorySnapshot: () => ({ entries: [], index: -1 })
    } as unknown as TabReopeningAccess<TabReopeningTab>
    const tab: TabReopeningTab = {
      id: 'opened', url: 'https://download.example/report.pdf', title: '', pinned: false, zoomIsolated: false,
      tabMuted: false, tabAgentPaused: false, humanInteractionLocked: false
    }
    rememberClosedTab(access, { ...tab, leftEmptyByDownload: true })
    expect(closedTabs).toEqual([])
    rememberClosedTab(access, tab)
    expect(closedTabs.map((closed) => closed.url)).toEqual(['https://download.example/report.pdf'])
  })
})
