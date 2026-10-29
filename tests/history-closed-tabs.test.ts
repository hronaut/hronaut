import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BrowserClosedTabState } from '../src/shared/types.js'
import { createBookmarksAndHistory } from '../src/main/bookmarks-history/bookmarks-and-history.js'
import { Browser } from '../src/main/browser/browser.js'
import { forgetClosedTabs, reopenClosedTabEntry } from '../src/main/browser/tab-reopening/tab-reopening.js'
import type { TabReopeningAccess, TabReopeningTab } from '../src/main/browser/tab-reopening/tab-reopening-access.js'
import { HistoryStore } from '../src/main/bookmarks-history/history-store.js'
import { registerBrowsingDataIpc } from '../src/main/site-data/browsing-data-ipc.js'
import { registerCollectionIpc } from '../src/main/collection-ipc.js'
import { createSiteData } from '../src/main/site-data/site-data.js'

vi.mock('electron', () => ({
  session: {}, WebContentsView: class {}, nativeImage: {}, shell: {}, app: { getPath: () => tmpdir() }, powerMonitor: { on: () => undefined }
}))

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

function closedTab(url: string, mcpGroupId?: string): BrowserClosedTabState {
  return { id: `closed-${url}`, title: url, url, pinned: false, closedAt: '2026-10-20T16:00:00.000Z', ...(mcpGroupId ? { mcpGroupId } : {}) }
}

/**
 * Recently closed tabs as the tab manager keeps them, with the manager's own forgetting function. Reopening one opens
 * no tab until the test calls failOpening, and then fails, as opening a tab in a workspace that just closed does.
 */
function recentlyClosed(urls: string[], mcpGroupId?: string) {
  const closedTabs = urls.map((url) => closedTab(url, mcpGroupId))
  const detachedClosedTabs = new Set<BrowserClosedTabState[]>()
  let failOpening!: (error: Error) => void
  const access = {
    closedTabs: () => closedTabs,
    detachedClosedTabs: () => detachedClosedTabs,
    tabCount: () => 1,
    createTab: () => new Promise<never>((_resolve, reject) => { failOpening = reject })
  } as unknown as TabReopeningAccess<TabReopeningTab>
  return {
    closedTabs,
    access,
    failOpening: (error: Error) => failOpening(error),
    tabs: { forgetHistoryPages: vi.fn((matches: (url: string) => boolean, workspaceId?: string) => { forgetClosedTabs(access, matches, workspaceId) }) }
  }
}

/** Pages of other websites than https://shop.example: another port, another scheme and a subdomain. */
const otherWebsites = ['https://shop.example:8443/cart', 'http://shop.example/cart', 'https://www.shop.example/']

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
    tabs.forgetHistoryPages((url) => url.startsWith('https://a.example/'))
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
      'https://docs.example/guide#install', 'https://user:secret@docs.example/guide', 'https://docs.example/guide?page=2',
      'https://docs.example/other'
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
    // The same page with another query is another history entry, so its closed tab stays.
    expect(closedTabs.map((tab) => tab.url)).toEqual(['https://docs.example/guide?page=2', 'https://docs.example/other'])
    // An id that is not in the history forgets nothing.
    await runtime.agentHistory.remove('missing')
    expect(closedTabs).toHaveLength(2)
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
      tabs: () => { throw new Error('Not used') },
      publishBookmarks: () => [],
      publishVisitHistory: () => [],
      historyCleared,
      historyEntryRemoved
    })
    const guide = history.list()[0]!.id
    await handlers.get('visit-history:remove')!({}, guide)
    // A page already gone from the history names nothing.
    await handlers.get('visit-history:remove')!({}, guide)
    expect(historyEntryRemoved).toHaveBeenCalledExactlyOnceWith('https://docs.example/guide')
    await handlers.get('visit-history:clear')!({})
    expect(historyCleared).toHaveBeenCalledOnce()
  })

  it('forgets the closed tabs of a website whose history Privacy clears, and all of them for all history', async () => {
    const { closedTabs, tabs } = recentlyClosed([
      'https://shop.example/cart', 'https://shop.example:443/account', ...otherWebsites, 'https://news.example/', 'not a url'
    ])
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
    expect(closedTabs.map((tab) => tab.url)).toEqual([...otherWebsites, 'https://news.example/', 'not a url'])
    await handlers.get('browsing-data:clear')!({}, { history: true })
    expect(closedTabs).toEqual([])
  })

  // As Chrome's Delete browsing data, the last hour goes and what was visited before it stays. Electron gives a tab's
  // pages no visit times, so Recently closed keeps only pages the history shows a visit to from before the hour only.
  it('clears a time range of history, with those pages\' closed tabs and the steps Home lists from then', async () => {
    const hour = 60 * 60 * 1000
    const { closedTabs, tabs } = recentlyClosed([
      'https://old.example/', 'https://recent.example/page#top', 'https://never.example/', 'https://both.example/',
      'view-source:https://old.example/', 'view-source:https://recent.example/page', 'data:text/html,private'
    ])
    const directory = await mkdtemp(join(tmpdir(), 'hronaut-history-closed-tabs-test-'))
    temporaryDirectories.push(directory)
    let now = Date.now() - 3 * hour
    const history = new HistoryStore(join(directory, 'history.json'), () => now)
    await history.load()
    await history.record({ url: 'https://old.example/', title: 'Old' })
    await history.record({ url: 'https://both.example/', title: 'Both' })
    now = Date.now()
    await history.record({ url: 'https://recent.example/page', title: 'Recent' })
    await history.record({ url: 'https://both.example/', title: 'Both' })
    const handlers = new Map<string, (...args: unknown[]) => unknown>()
    const forgetAgentStepsSince = vi.fn()
    registerBrowsingDataIpc({
      assertTrustedSender: () => undefined,
      handleBrowserIpc: ((channel: string, listener: (...args: unknown[]) => unknown) => { handlers.set(channel, listener) }) as never,
      tabs: () => ({ ...tabs, getState: () => ({ tabs: [] }) }) as never,
      historyStore: () => history,
      bookmarkStore: () => null,
      credentialStore: () => null,
      sitePermissionStore: () => null,
      mcpServer: () => ({ forgetAgentStepsSince }),
      publishVisitHistory: () => undefined,
      currentBrowsingDataSiteSummary: async () => { throw new Error('Not used') }
    })
    const clear = async (options: unknown) => handlers.get('browsing-data:clear')!({}, options)
    const before = Date.now()
    await clear({ history: true, timeRange: 'lastHour' })
    expect(history.list().map(({ url, visitCount }) => [url, visitCount])).toEqual([['https://both.example/', 1], ['https://old.example/', 1]])
    expect(closedTabs.map((tab) => tab.url)).toEqual(['https://old.example/', 'view-source:https://old.example/'])
    expect(forgetAgentStepsSince).toHaveBeenCalledOnce()
    const [since] = forgetAgentStepsSince.mock.calls[0] as [number]
    expect(since).toBeGreaterThanOrEqual(before - hour)
    expect(since).toBeLessThanOrEqual(Date.now() - hour)

    for (const options of [
      { history: true, timeRange: 'lastYear' },
      { history: true, timeRange: 3_600_000 },
      // A website's history is cleared for all time, as in Chrome.
      { history: true, origin: 'https://old.example', timeRange: 'lastHour' }
    ]) await expect(clear(options)).rejects.toThrow('Invalid history clearing options')
    await clear({ history: true, timeRange: 'allTime' })
    expect(history.list()).toEqual([])
    expect(closedTabs).toEqual([])
    // All time: every step agents took goes.
    expect(forgetAgentStepsSince).toHaveBeenCalledTimes(2)
    expect(forgetAgentStepsSince.mock.calls[1]).toEqual([])
  })

  it('forgets the closed tabs of a website whose history an agent clears, only in its workspace', async () => {
    const { closedTabs, tabs } = recentlyClosed(['https://shop.example/cart', ...otherWebsites, 'https://news.example/'], 'workspace')
    // The person's tab on the website in another workspace is not the agent's to forget.
    closedTabs.push(closedTab('https://shop.example/orders', 'other-workspace'))
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
    expect(tabs.forgetHistoryPages).toHaveBeenCalledWith(expect.any(Function), 'workspace')
    expect(closedTabs.map((tab) => tab.url)).toEqual([...otherWebsites, 'https://news.example/', 'https://shop.example/orders'])
  })

  it('keeps a closed tab forgotten when the history is cleared while it reopens and reopening it fails', async () => {
    const { closedTabs, access, failOpening, tabs } = recentlyClosed(['https://bank.example/statement', 'https://news.example/'])
    const reopening = reopenClosedTabEntry(access, closedTabs[0]!.id, true)
    tabs.forgetHistoryPages(() => true)
    failOpening(new Error('The tab could not be opened.'))
    await expect(reopening).rejects.toThrow('could not be opened')
    // The failed reopening used to put the statement back in Recently closed, after Clear all had forgotten it.
    expect(closedTabs).toEqual([])
  })

  it('remembers a closed tab again when reopening it fails and the history cleared meanwhile did not show it', async () => {
    const { closedTabs, access, failOpening, tabs } = recentlyClosed(['https://bank.example/statement', 'https://news.example/'])
    const reopening = reopenClosedTabEntry(access, closedTabs[0]!.id, true)
    tabs.forgetHistoryPages((url) => url === 'https://news.example/')
    failOpening(new Error('The tab could not be opened.'))
    await expect(reopening).rejects.toThrow('could not be opened')
    expect(closedTabs.map((tab) => tab.url)).toEqual(['https://bank.example/statement'])
  })
})

describe('the tab manager forgetting recently closed tabs', () => {
  it('publishes the state, without saving the session, only when it forgets one, also one held aside', () => {
    const reopening = [closedTab('https://bank.example/statement')]
    const changed = vi.fn()
    const internals = {
      closedTabs: [closedTab('https://news.example/'), closedTab('https://bank.example/')],
      detachedClosedTabs: new Set([reopening]),
      tabs: new Map(),
      changed
    }
    const manager = Object.assign(Object.create(Browser.prototype), internals) as Browser
    manager.forgetHistoryPages((url) => url.startsWith('https://mail.example/'))
    expect(changed).not.toHaveBeenCalled()

    // A tab held aside while it reopens is forgotten too, so it cannot come back.
    manager.forgetHistoryPages((url) => url === 'https://bank.example/statement')
    expect(reopening).toEqual([])
    expect(changed).toHaveBeenCalledExactlyOnceWith(false)

    manager.forgetHistoryPages((url) => url.startsWith('https://bank.example/'))
    expect(internals.closedTabs.map((tab) => tab.url)).toEqual(['https://news.example/'])
    expect(changed).toHaveBeenCalledTimes(2)
    expect(changed).toHaveBeenLastCalledWith(false)
  })
})
