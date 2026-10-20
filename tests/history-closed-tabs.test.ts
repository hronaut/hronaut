import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BrowserClosedTabState } from '../src/shared/types.js'
import { createBookmarksAndHistory } from '../src/main/bookmarks-and-history.js'
import { forgetClosedTabs } from '../src/main/browser/tab-reopening/tab-reopening.js'
import type { TabReopeningAccess, TabReopeningTab } from '../src/main/browser/tab-reopening/tab-reopening-access.js'
import { HistoryStore } from '../src/main/history-store.js'
import { registerBrowsingDataIpc } from '../src/main/browsing-data-ipc.js'
import { registerCollectionIpc } from '../src/main/collection-ipc.js'
import { createSiteData } from '../src/main/site-data.js'

vi.mock('electron', () => ({ app: { getPath: () => tmpdir() } }))

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

function closedTab(url: string): BrowserClosedTabState {
  return { id: `closed-${url}`, title: url, url, pinned: false, closedAt: '2026-10-20T16:00:00.000Z' }
}

/** Recently closed tabs as the tab manager keeps them, with the manager's own forgetting function. */
function recentlyClosed(urls: string[]) {
  const closedTabs = urls.map(closedTab)
  const access = { closedTabs: () => closedTabs } as unknown as TabReopeningAccess<TabReopeningTab>
  return { closedTabs, tabs: { forgetClosedTabs: vi.fn((matches: (url: string) => boolean) => { forgetClosedTabs(access, matches) }) } }
}

async function historyWith(urls: string[]): Promise<HistoryStore> {
  const directory = await mkdtemp(join(tmpdir(), 'hronaut-history-closed-tabs-test-'))
  temporaryDirectories.push(directory)
  const history = new HistoryStore(join(directory, 'history.json'))
  await history.load()
  for (const url of urls) await history.record({ url, title: url })
  return history
}

describe('recently closed tabs and the history', () => {
  it('forgets only the closed tabs whose address matches', () => {
    const { closedTabs, tabs } = recentlyClosed(['https://a.example/', 'https://b.example/x', 'https://a.example/y'])
    tabs.forgetClosedTabs((url) => url.startsWith('https://a.example/'))
    expect(closedTabs.map((tab) => tab.url)).toEqual(['https://b.example/x'])
  })

  it('forgets every closed tab when an agent or the person clears the history', async () => {
    // Clear all kept every Recently closed tab, its title and full address, listed in Tab search and reopened by
    // Ctrl/Cmd+Shift+T, and agents still read them in the workspace's state.
    const { closedTabs, tabs } = recentlyClosed(['https://bank.example/statement?id=7', 'https://news.example/'])
    const history = await historyWith(['https://bank.example/statement?id=7'])
    const runtime = createBookmarksAndHistory({
      state: { bookmarks: null, history },
      sendToShellWindows: vi.fn(),
      mcpServer: () => null,
      tabs: () => tabs,
      offerUndo: vi.fn()
    })
    await runtime.agentHistory.clear()
    expect(closedTabs).toEqual([])

    closedTabs.push(closedTab('https://mail.example/inbox'))
    runtime.historyCleared()
    expect(closedTabs).toEqual([])
  })

  it('forgets the closed tabs of one removed history page, fragment and sign-in aside', async () => {
    const { closedTabs, tabs } = recentlyClosed([
      'https://docs.example/guide#install', 'https://user:secret@docs.example/guide', 'https://docs.example/other'
    ])
    const history = await historyWith(['https://docs.example/guide', 'https://docs.example/other'])
    const runtime = createBookmarksAndHistory({
      state: { bookmarks: null, history },
      sendToShellWindows: vi.fn(),
      mcpServer: () => null,
      tabs: () => tabs,
      offerUndo: vi.fn()
    })
    const guide = history.list().find((entry) => entry.url === 'https://docs.example/guide')!
    await runtime.agentHistory.remove(guide.id)
    expect(closedTabs.map((tab) => tab.url)).toEqual(['https://docs.example/other'])
    // An id that is not in the history forgets nothing.
    await runtime.agentHistory.remove('missing')
    expect(closedTabs).toHaveLength(1)
  })

  it('tells the runtime which page the person removed from the history panel', async () => {
    const history = await historyWith(['https://docs.example/guide'])
    const handlers = new Map<string, (...args: unknown[]) => unknown>()
    const historyEntryRemoved = vi.fn()
    const historyCleared = vi.fn()
    registerCollectionIpc({ handle: (channel: string, listener: (...args: unknown[]) => unknown) => { handlers.set(channel, listener) } } as never, {
      runRead: async (_event, read) => read(),
      assertTrustedSender: () => undefined,
      bookmarks: () => { throw new Error('Not used') },
      history: () => history,
      downloads: () => { throw new Error('Not used') },
      publishBookmarks: () => [],
      publishVisitHistory: () => [],
      historyCleared,
      historyEntryRemoved
    })
    await handlers.get('visit-history:remove')!({}, history.list()[0]!.id)
    expect(historyEntryRemoved).toHaveBeenCalledExactlyOnceWith('https://docs.example/guide')
    await handlers.get('visit-history:clear')!({})
    expect(historyCleared).toHaveBeenCalledOnce()
  })

  it('forgets the closed tabs of a website whose history Privacy clears, and all of them for all history', async () => {
    const { closedTabs, tabs } = recentlyClosed(['https://shop.example/cart', 'https://news.example/', 'not a url'])
    const history = await historyWith(['https://shop.example/cart', 'https://news.example/'])
    const handlers = new Map<string, (...args: unknown[]) => unknown>()
    registerBrowsingDataIpc({
      assertTrustedSender: () => undefined,
      handleBrowserIpc: ((channel: string, listener: (...args: unknown[]) => unknown) => { handlers.set(channel, listener) }) as never,
      tabs: () => ({ ...tabs, getState: () => ({ tabs: [] }) }) as never,
      historyStore: () => history,
      bookmarkStore: () => null,
      credentialStore: () => null,
      sitePermissionStore: () => null,
      mcpServer: () => null,
      publishVisitHistory: () => undefined,
      currentBrowsingDataSiteSummary: async () => { throw new Error('Not used') }
    })
    await handlers.get('browsing-data:clear')!({}, { history: true, origin: 'https://shop.example' })
    expect(closedTabs.map((tab) => tab.url)).toEqual(['https://news.example/', 'not a url'])
    await handlers.get('browsing-data:clear')!({}, { history: true })
    expect(closedTabs).toEqual([])
  })

  it('forgets the closed tabs of a website whose history an agent clears', async () => {
    const { closedTabs, tabs } = recentlyClosed(['https://shop.example/cart', 'https://news.example/'])
    const history = await historyWith(['https://shop.example/cart'])
    const browserSession = { cookies: { get: async () => [] } }
    const { agentSiteData } = createSiteData({
      tabs: () => ({
        ...tabs,
        workspaceSession: () => browserSession,
        withWorkspaceSiteDataCleanup: (_workspaceId: string, clear: (session: unknown) => Promise<unknown>) => clear(browserSession)
      }) as never,
      historyStore: () => history,
      publishVisitHistory: () => undefined
    })
    await agentSiteData.clear('workspace', 'https://shop.example', ['history'])
    expect(closedTabs.map((tab) => tab.url)).toEqual(['https://news.example/'])
  })
})
