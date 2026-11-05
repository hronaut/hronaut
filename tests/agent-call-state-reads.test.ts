import { describe, expect, it, vi } from 'vitest'
import { hasPausedAgentTab } from '../src/main/browser/agent-pause/agent-pause.js'
import { navigationButtons } from '../src/main/browser/navigation-history.js'
import { SLEEPING_PAGE_URL } from '../src/main/browser/tab-sleep/sleeping-page.js'
import { BrowserVideoRecorder } from '../src/main/browser/video-recorder.js'
import { getMcpGroupState } from '../src/main/browser/workspace-scope/workspace-scope.js'

// Under four agents, main was busy more than half the time, a third of it building every tab's state on each agent
// call: to read whether any tab is paused, to read one workspace's tabs, and in each tab its video recording as a deep
// copy and its Back and Forward from its history's pages, each with its saved page state.

/** A stand-in for whatever the state reads on the browser: any call or property gives another stand-in. */
function anything(): unknown {
  const stand: unknown = new Proxy(() => undefined, {
    get: (_target, key) => key === 'then' || key === Symbol.iterator ? undefined : stand,
    apply: () => stand
  })
  return stand
}

function tab(id: string, workspaceId: string, fields: Record<string, unknown> = {}) {
  return {
    id, mcpGroupId: workspaceId, title: id, url: `https://${id}.example/`, loading: false, observationGeneration: 0, navigationGeneration: 0,
    documentGeneration: 0, pinned: false, sleeping: false, tabAgentPaused: false, networkRoutes: [], inspectorIssues: [],
    webContents: { session: {}, isDestroyed: () => false, getZoomFactor: vi.fn(() => 1), isDevToolsOpened: () => false },
    ...fields
  }
}

/** A browser with two workspaces' tabs, whose every other field is a stand-in. */
function browserWith(tabs: ReturnType<typeof tab>[], fields: Record<string, unknown> = {}) {
  const workspace = (id: string) => ({
    id, name: id, description: '', color: 'blue', createdAt: '', activeTabId: undefined, origins: [], navigationPolicy: { mode: 'open', rules: [] }
  })
  const own: Record<string, unknown> = {
    tabs: new Map(tabs.map((entry) => [entry.id, entry])),
    mcpTabGroups: new Map([['first', workspace('first')], ['second', workspace('second')]]),
    closedTabs: [],
    activeTabId: tabs[0]?.id ?? null,
    splitView: null,
    allAgentsPaused: false,
    agentPauseOverridesAllowed: true,
    globallyResumedAgentTabIds: new Set<string>(),
    statePublication: { beforeRead: vi.fn() },
    listMcpTabGroups: () => [],
    listSavedTabGroups: () => [],
    agentFollow: undefined,
    options: { profilePath: '/profile' },
    isTabTakenOver: () => false,
    ...fields
  }
  const fallback = anything() as Record<string | symbol, unknown>
  return { own, browser: new Proxy({}, { get: (_target, key) => (typeof key === 'string' && key in own ? own[key] : fallback[key]) }) as never }
}

describe('what an agent call reads of the browser', () => {
  it('finds a paused tab from the tabs\' pauses alone, without building or sending the browser state', () => {
    const tabs = [tab('one', 'first'), tab('two', 'second')]
    const { own, browser } = browserWith(tabs)
    expect(hasPausedAgentTab(browser)).toBe(false)
    tabs[1]!.tabAgentPaused = true
    expect(hasPausedAgentTab(browser)).toBe(true)
    // Under a global pause, every tab is paused but the ones resumed as exceptions.
    tabs[1]!.tabAgentPaused = false
    own.allAgentsPaused = true
    own.globallyResumedAgentTabIds = new Set(['one', 'two'])
    expect(hasPausedAgentTab(browser)).toBe(false)
    own.globallyResumedAgentTabIds = new Set(['one'])
    expect(hasPausedAgentTab(browser)).toBe(true)
    // Exceptions count only while they are allowed.
    own.globallyResumedAgentTabIds = new Set(['one', 'two'])
    own.agentPauseOverridesAllowed = false
    expect(hasPausedAgentTab(browser)).toBe(true)
    expect(tabs.every((entry) => entry.webContents.getZoomFactor.mock.calls.length === 0)).toBe(true)
    expect((own.statePublication as { beforeRead: ReturnType<typeof vi.fn> }).beforeRead).not.toHaveBeenCalled()
  })

  it('builds only the tabs of the workspace it reads', () => {
    const tabs = [tab('one', 'first'), tab('two', 'second'), tab('three', 'first')]
    const { own, browser } = browserWith(tabs)
    const state = getMcpGroupState(browser, 'first')
    expect(state.tabs.map((entry) => entry.id)).toEqual(['one', 'three'])
    expect(state.activeTabId).toBe('one')
    expect(tabs[1]!.webContents.getZoomFactor).not.toHaveBeenCalled()
    expect(tabs[0]!.webContents.getZoomFactor).toHaveBeenCalledOnce()
    // As any read of the state, a change still waiting to be published goes out first.
    expect((own.statePublication as { beforeRead: ReturnType<typeof vi.fn> }).beforeRead).toHaveBeenCalledOnce()
    expect(() => getMcpGroupState(browser, 'missing')).toThrow()
  })

  it('reads a tab\'s video recording status without copying the recording\'s state', () => {
    const recorder = new BrowserVideoRecorder({} as never)
    expect(recorder.status('tab')).toBe('idle')
    const copy = vi.spyOn(globalThis, 'structuredClone')
    try {
      Reflect.get(recorder, 'recordings').set('tab', { state: { status: 'recording' } })
      expect(recorder.status('tab')).toBe('recording')
      expect(copy).not.toHaveBeenCalled()
    } finally {
      copy.mockRestore()
    }
  })
})

describe('a tab\'s Back and Forward', () => {
  function liveTab(urls: string[], index: number) {
    const history = { urls, index }
    const getEntryAtIndex = vi.fn((at: number) => (at in history.urls ? { url: history.urls[at], title: '', pageState: 'saved' } : null))
    const tab = {
      id: 'tab', navigationGeneration: 0, documentGeneration: 0,
      webContents: {
        isDestroyed: () => false,
        navigationHistory: { length: () => history.urls.length, getActiveIndex: () => history.index, getEntryAtIndex }
      }
    }
    return { tab, history, getEntryAtIndex }
  }

  it('are read from its history\'s pages again only once the history moved', () => {
    const { tab, history, getEntryAtIndex } = liveTab(['https://a.example/', 'https://b.example/'], 1)
    expect(navigationButtons(tab as never)).toEqual({ canGoBack: true, canGoForward: false })
    const reads = getEntryAtIndex.mock.calls.length
    expect(navigationButtons(tab as never)).toEqual({ canGoBack: true, canGoForward: false })
    expect(getEntryAtIndex).toHaveBeenCalledTimes(reads)

    // A page added in the same document, as with history.pushState, which starts a navigation.
    history.urls = [...history.urls, 'https://b.example/#more']
    history.index = 2
    tab.navigationGeneration += 1
    expect(navigationButtons(tab as never)).toEqual({ canGoBack: true, canGoForward: false })
    // Back in the same document.
    history.index = 1
    tab.navigationGeneration += 1
    expect(navigationButtons(tab as never)).toEqual({ canGoBack: true, canGoForward: true })
    // A page removed from the history, as clearing it does.
    history.urls = [history.urls[0]!, history.urls[1]!]
    expect(navigationButtons(tab as never)).toEqual({ canGoBack: true, canGoForward: false })
    // A navigation that leaves the place and length as they were, as one replacing the forward pages.
    history.urls = ['https://c.example/', history.urls[1]!]
    tab.navigationGeneration += 1
    const before = getEntryAtIndex.mock.calls.length
    navigationButtons(tab as never)
    expect(getEntryAtIndex.mock.calls.length).toBeGreaterThan(before)
  })

  it('are read again when a tab woke on the page it slept on, whose history kept its place and length', () => {
    // Asleep on b, the tab's forward page gave way to the sleeping page; waking goes back to b.
    const { tab, history } = liveTab(['https://a.example/', 'https://b.example/', 'https://c.example/'], 1)
    expect(navigationButtons(tab as never)).toEqual({ canGoBack: true, canGoForward: true })
    history.urls = ['https://a.example/', 'https://b.example/', SLEEPING_PAGE_URL]
    history.index = 2
    tab.navigationGeneration += 1
    history.index = 1
    tab.navigationGeneration += 1
    expect(navigationButtons(tab as never)).toEqual({ canGoBack: true, canGoForward: false })
  })

  it('are kept for each tab apart', () => {
    const first = liveTab(['https://a.example/', 'https://b.example/'], 1)
    const second = liveTab(['https://a.example/', 'https://b.example/'], 0)
    expect(navigationButtons(first.tab as never)).toEqual({ canGoBack: true, canGoForward: false })
    expect(navigationButtons(second.tab as never)).toEqual({ canGoBack: false, canGoForward: true })
  })
})
