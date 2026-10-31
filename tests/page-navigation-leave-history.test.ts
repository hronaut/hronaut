import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { back, forward, goToHistoryEntry, reload, reloadIgnoringCache } from '../src/main/browser/page-navigation/page-navigation.js'

// The browser below stubs getState, which navigating publishes through.
vi.mock('../src/main/browser/browser-state/browser-state.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/main/browser/browser-state/browser-state.js')>(),
  browserState: (browser: { getState: () => unknown }) => browser.getState()
}))
// Giving a page the keyboard back and the person's own tab switch reach the fake's stubs.
vi.mock('../src/main/browser/trusted-chrome-focus/trusted-chrome-focus.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/main/browser/trusted-chrome-focus/trusted-chrome-focus.js')>(),
  focusPageAfterQuestion: (browser: { focusPageAfterQuestion: (...args: unknown[]) => unknown }, ...args: unknown[]) => browser.focusPageAfterQuestion(...args)
}))
// The fake browser decides which pages a workspace may open.
vi.mock('../src/main/browser/workspace-navigation/workspace-navigation.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/main/browser/workspace-navigation/workspace-navigation.js')>(),
  workspaceNavigationAllowed: (browser: { workspaceNavigationAllowed: (...args: unknown[]) => boolean }, ...args: unknown[]) => (
    browser.workspaceNavigationAllowed(...args)
  ),
  workspaceMayOpen: (browser: { workspaceMayOpen: (...args: unknown[]) => boolean }, ...args: unknown[]) => browser.workspaceMayOpen(...args)
}))
vi.mock('../src/main/browser/tab-selection/person-tab-switch.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/main/browser/tab-selection/person-tab-switch.js')>(),
  selectTabForPerson: (browser: { selectTabForPerson: (...args: unknown[]) => unknown }, ...args: unknown[]) => browser.selectTabForPerson(...args)
}))

// Reload, Back, Forward and a page picked from their history list did nothing at all on a page that asks before it is
// left, as an editor with unsaved changes does: Electron keeps the page when nothing answers its question, and nothing
// said so. Chrome asks "Leave site?" or "Reload site?". An agent's browser_history reported success.

const PAGES = ['https://editor.example/first', 'https://editor.example/draft', 'https://editor.example/next']

/**
 * A navigation's start, as Electron reports it: its details, then the same as arguments of old. One the page makes within
 * itself names its frame.
 */
function started(page: EventEmitter, details: { isSameDocument?: boolean; initiator?: object } = {}): void {
  const isSameDocument = details.isSameDocument ?? false
  page.emit('did-start-navigation', { url: PAGES[2], isMainFrame: true, isSameDocument, ...details }, PAGES[2], isSameDocument, true)
}

function pageThatAsksToStay(confirmLeavePage: (question: 'leave' | 'reload') => Promise<boolean> = async () => false) {
  const calls: string[] = []
  const page = {
    asks: true,
    /** Within the page, as to an entry a web app added: no question, as in Chromium. */
    sameDocument: false,
    /** What the page does just before its question reaches Hronaut. */
    beforeQuestion: () => undefined as void
  }
  // As Electron: the page's question goes to will-prevent-unload a moment after the navigation is asked for, and the
  // navigation starts only when it was prevented; otherwise the page stops loading where it was.
  const navigation = (name: string) => vi.fn(() => {
    calls.push(name)
    setImmediate(() => {
      if (page.sameDocument) {
        started(webContents, { isSameDocument: true })
        return
      }
      page.beforeQuestion()
      let left = !page.asks
      if (page.asks) webContents.emit('will-prevent-unload', { preventDefault: () => { left = true } })
      if (left) started(webContents)
      else webContents.emit('did-stop-loading')
    })
  })
  const history = {
    activeIndex: 1,
    entries: [...PAGES],
    canGoBack: () => true,
    canGoForward: () => true,
    getActiveIndex: () => history.activeIndex,
    getAllEntries: () => history.entries.map(url => ({ url, title: url })),
    goBack: navigation('back'),
    goForward: navigation('forward'),
    goToIndex: navigation('go to')
  }
  const webContents = Object.assign(new EventEmitter(), {
    isDestroyed: () => false,
    isCrashed: () => false,
    isLoading: () => false,
    navigationHistory: history,
    reload: navigation('reload'),
    reloadIgnoringCache: navigation('reload ignoring cache')
  })
  const tab = { id: 'tab', navigationGeneration: 0, documentGeneration: 0, sleeping: false, webContents } as {
    id: string; navigationGeneration: number; documentGeneration: number; sleeping: boolean; webContents: typeof webContents
    mcpGroupId?: string
  }
  const tabs = new Map([[tab.id, tab]])
  const browser = {
    tabs,
    // The tab is behind the one shown, so asking about its page brings it into view first.
    activeTabId: 'shown',
    destroyed: false,
    window: { isDestroyed: () => false },
    statePublication: { changed: vi.fn() },
    options: { confirmBeforeUnloadLeave: vi.fn(confirmLeavePage) },
    rendererRecovery: { isRecovering: () => false },
    prepareDiagnosticNavigation: vi.fn(),
    selectTabForPerson: vi.fn(async (_tabId: string) => undefined),
    focusPageAfterQuestion: vi.fn(),
    workspaceNavigationAllowed: vi.fn(() => true),
    workspaceMayOpen: vi.fn((_groupId: string, _url: string) => true),
    getState: () => ({ ok: true })
  }
  const listening = (): number => ['will-prevent-unload', 'did-start-navigation', 'did-stop-loading', 'destroyed']
    .reduce((count, event) => count + webContents.listenerCount(event), 0)
  return {
    calls, tab, tabs, history, webContents, listening, page, browser: browser as typeof browser & never, fake: browser,
    stopAsking: () => { page.asks = false }
  }
}

describe('Reload, Back and Forward from a page that asks before it is left', () => {
  it('tell an agent the page stayed open', async () => {
    for (const go of [back, forward, reload, reloadIgnoringCache]) {
      const { browser, fake, listening } = pageThatAsksToStay()
      await expect(go(browser, 'tab')).rejects.toThrow('The page asked to confirm before it is left (a beforeunload prompt, as a page '
        + 'with unsaved changes shows), so it stayed open and nothing was loaded.')
      expect(fake.options.confirmBeforeUnloadLeave).not.toHaveBeenCalled()
      expect(listening()).toBe(0)
    }
  })

  it('ask a person over the page, and keep it when they keep editing', async () => {
    const { browser, fake, calls, tab, listening } = pageThatAsksToStay(async () => false)
    const order: string[] = []
    fake.selectTabForPerson.mockImplementation(async () => { order.push('shown') })
    fake.options.confirmBeforeUnloadLeave.mockImplementation(async (question) => { order.push(`asked ${question}`); return false })
    await expect(back(browser, 'tab', { byPerson: true })).resolves.toEqual({ ok: true })
    await reload(browser, 'tab', { byPerson: true })
    expect(order).toEqual(['shown', 'asked leave', 'shown', 'asked reload'])
    expect(calls).toEqual(['back', 'reload'])
    expect(fake.focusPageAfterQuestion.mock.calls).toEqual([[tab.webContents], [tab.webContents]])
    expect(listening()).toBe(0)
  })

  it('go once the person leaves the page, without asking again', async () => {
    for (const [go, name, question] of [
      [back, 'back', 'leave'], [forward, 'forward', 'leave'], [reload, 'reload', 'reload'],
      [reloadIgnoringCache, 'reload ignoring cache', 'reload']
    ] as const) {
      const { browser, fake, calls, listening } = pageThatAsksToStay(async () => true)
      await go(browser, 'tab', { byPerson: true })
      expect(fake.options.confirmBeforeUnloadLeave).toHaveBeenCalledExactlyOnceWith(question)
      expect(calls).toEqual([name, name])
      expect(fake.focusPageAfterQuestion).not.toHaveBeenCalled()
      expect(listening()).toBe(0)
    }
  })

  it('go nowhere once the page went elsewhere or its tab closed while the person was asked', async () => {
    const moved = pageThatAsksToStay(async () => { moved.tab.documentGeneration++; return true })
    await back(moved.browser, 'tab', { byPerson: true })
    expect(moved.calls).toEqual(['back'])
    const closed = pageThatAsksToStay(async () => { closed.tabs.clear(); return true })
    await reload(closed.browser, 'tab', { byPerson: true })
    expect(closed.calls).toEqual(['reload'])
  })

  it('ask nothing when the page does not ask', async () => {
    const { browser, fake, calls, stopAsking, listening } = pageThatAsksToStay()
    stopAsking()
    await back(browser, 'tab')
    await reload(browser, 'tab', { byPerson: true })
    expect(calls).toEqual(['back', 'reload'])
    expect(fake.options.confirmBeforeUnloadLeave).not.toHaveBeenCalled()
    expect(listening()).toBe(0)
  })
})

describe('the page asked about', () => {
  it('is still asked about when it changes its address within itself just before its question', async () => {
    const { browser, fake, page, webContents, calls } = pageThatAsksToStay(async () => false)
    page.beforeQuestion = () => { started(webContents, { isSameDocument: true, initiator: {} }) }
    await expect(back(browser, 'tab')).rejects.toThrow('so it stayed open and nothing was loaded')
    await reload(browser, 'tab', { byPerson: true })
    expect(fake.options.confirmBeforeUnloadLeave).toHaveBeenCalledExactlyOnceWith('reload')
    expect(calls).toEqual(['back', 'reload'])
  })

  it('is not asked about by a Back within itself, which goes at once', async () => {
    const { browser, fake, page, calls, listening } = pageThatAsksToStay()
    page.sameDocument = true
    await back(browser, 'tab')
    expect(calls).toEqual(['back'])
    expect(fake.options.confirmBeforeUnloadLeave).not.toHaveBeenCalled()
    expect(listening()).toBe(0)
  })

  it('keeps Back and Forward from going once it moved in its history while the person was asked', async () => {
    // Adding an entry within the page drops the pages Forward went to.
    const pruned = pageThatAsksToStay(async () => { pruned.history.entries.splice(2, 1, 'https://editor.example/draft#saved'); return true })
    await forward(pruned.browser, 'tab', { byPerson: true })
    expect(pruned.calls).toEqual(['forward'])
    expect(pruned.listening()).toBe(0)
    const moved = pageThatAsksToStay(async () => { moved.history.activeIndex = 2; return true })
    await back(moved.browser, 'tab', { byPerson: true })
    expect(moved.calls).toEqual(['back'])
    const refused = pageThatAsksToStay(async () => { refused.fake.workspaceNavigationAllowed.mockReturnValue(false); return true })
    refused.tab.mcpGroupId = 'client'
    await back(refused.browser, 'tab', { byPerson: true })
    expect(refused.calls).toEqual(['back'])
    // Saving the address within the page while the person was asked still goes back.
    const saved = pageThatAsksToStay(async () => { saved.history.entries[1] = 'https://editor.example/draft?saved'; return true })
    await back(saved.browser, 'tab', { byPerson: true })
    expect(saved.calls).toEqual(['back', 'back'])
  })

  it('is asked about one page at a time, each over its own page, as when Reload of several tabs asks', async () => {
    const first = pageThatAsksToStay()
    const second = pageThatAsksToStay()
    second.tab.id = 'second'
    first.tabs.set('second', second.tab as never)
    const answers: Array<(leave: boolean) => void> = []
    first.fake.options.confirmBeforeUnloadLeave.mockImplementation(() => new Promise<boolean>(resolve => { answers.push(resolve) }))
    const reloads = Promise.all([reload(first.browser, 'tab', { byPerson: true }), reload(first.browser, 'second', { byPerson: true })])
    await vi.waitFor(() => expect(answers).toHaveLength(1))
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(first.fake.selectTabForPerson.mock.calls).toEqual([['tab']])
    answers[0]!(true)
    await vi.waitFor(() => expect(answers).toHaveLength(2))
    expect(first.fake.selectTabForPerson.mock.calls).toEqual([['tab'], ['second']])
    answers[1]!(false)
    await reloads
    expect([first.calls, second.calls]).toEqual([['reload', 'reload'], ['reload']])
  })
})

describe('a page picked from the history list, from a page that asks before it is left', () => {
  const draftsFirst = { index: 0, url: PAGES[0]!, activeIndex: 1 }

  it('goes there once the person leaves the page', async () => {
    const { browser, fake, calls } = pageThatAsksToStay(async () => true)
    await goToHistoryEntry(browser, 'tab', draftsFirst)
    expect(fake.options.confirmBeforeUnloadLeave).toHaveBeenCalledExactlyOnceWith('leave')
    expect(calls).toEqual(['go to', 'go to'])
  })

  it('goes nowhere once the tab moved in its history while the person was asked, rather than to another page', async () => {
    const { browser, history, calls } = pageThatAsksToStay(async () => { history.activeIndex = 2; return true })
    await goToHistoryEntry(browser, 'tab', draftsFirst)
    expect(calls).toEqual(['go to'])
    expect(history.goToIndex).toHaveBeenCalledExactlyOnceWith(0)
  })

  it('goes nowhere once the workspace may no longer open the page', async () => {
    const { browser, fake, tab, calls } = pageThatAsksToStay(async () => { fake.workspaceNavigationAllowed.mockReturnValue(false); return true })
    tab.mcpGroupId = 'client'
    await goToHistoryEntry(browser, 'tab', draftsFirst)
    expect(fake.workspaceNavigationAllowed).toHaveBeenCalledWith('client', PAGES[0], 'history')
    expect(calls).toEqual(['go to'])
  })
})

// Chromium's Back skips a page that opened the next by script without the person's activation, so it landed on the page
// before that one, which only the next page's check stood for: a page of a site the workspace no longer allows opened.
describe('Back and Forward in a workspace that may not open a page further along', () => {
  it('go exactly one step, to the page checked, and as Chromium goes otherwise', async () => {
    for (const [mayOpenFurther, groupId, expected] of [
      [false, 'client', ['go to', 'go to']], [true, 'client', ['back', 'forward']], [false, undefined, ['back', 'forward']]
    ] as const) {
      const { browser, fake, tab, history, calls, stopAsking } = pageThatAsksToStay()
      stopAsking()
      if (groupId) tab.mcpGroupId = groupId
      fake.workspaceMayOpen.mockImplementation((_groupId, url) => mayOpenFurther || url === PAGES[1])
      history.activeIndex = 2
      await back(browser, 'tab')
      history.activeIndex = 0
      await forward(browser, 'tab')
      expect(calls).toEqual(expected)
      if (expected[0] === 'go to') expect(history.goToIndex.mock.calls).toEqual([[1], [1]])
      // The page checked is still checked, and recorded when refused.
      if (groupId) expect(fake.workspaceNavigationAllowed.mock.calls).toEqual([['client', PAGES[1], 'history'], ['client', PAGES[1], 'history']])
      if (groupId) expect(fake.workspaceMayOpen.mock.calls).toEqual([['client', PAGES[0]], ['client', PAGES[2]]])
    }
  })
})
