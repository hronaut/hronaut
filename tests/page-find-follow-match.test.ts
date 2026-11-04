import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WebContents } from 'electron'
import { ISOLATED_WORLDS } from '../src/main/browser/isolated-worlds.js'

vi.mock('electron', () => ({ app: { isPackaged: false } }))

const { findInPage, stopFindInPage } = await import('../src/main/browser/page-find/page-find.js')
afterEach(() => vi.useRealTimers())
type Browser = import('../src/main/browser/browser.js').Browser
type PageTab = {
  id: string
  mcpGroupId?: string
  locked: boolean
  webContents: WebContents
  humanInteractionGeneration: number
  lastHumanInteractionAt: number
  lastActiveAt: number
  documentGeneration: number
}

function pageSearch(options: { locked?: boolean; occluded?: boolean; agentInput?: boolean; selecting?: boolean; matched?: boolean } = {}) {
  const tab: PageTab = {
    id: 'tab',
    mcpGroupId: 'workspace',
    locked: options.locked ?? false,
    webContents: {
      id: 4,
      isDestroyed: () => false,
      getURL: () => 'https://example.test/',
      isLoadingMainFrame: vi.fn(() => false),
      executeJavaScriptInIsolatedWorld: vi.fn(() => Promise.resolve())
    } as unknown as WebContents,
    humanInteractionGeneration: 7,
    lastHumanInteractionAt: 1,
    lastActiveAt: 1,
    documentGeneration: 0
  }
  // The controller selects or clicks only a match a search found.
  const stopPageSearch = vi.fn((_webContents: WebContents, action: 'clearSelection' | 'keepSelection' | 'activateSelection') => (
    action !== 'clearSelection' && (options.matched ?? true)
  ))
  const noteHumanInput = vi.fn()
  const onUserInteraction = vi.fn()
  const browser = {
    tabs: new Map([[tab.id, tab]]),
    pageFind: { search: vi.fn(async () => ({ activeMatchOrdinal: 1, matches: 3 })), stop: stopPageSearch },
    browserContentOccluded: options.occluded ?? false,
    isHumanInteractionLocked: (candidate: PageTab) => candidate.locked,
    agentInputWebContents: new Map(options.agentInput ? [[4, 1]] : []),
    screenshotAreaSessions: new Map(options.selecting ? [[4, {}]] : []),
    elementPickerSessions: new Map(),
    mcpActivityFollower: { noteHumanInput },
    options: { onUserInteraction }
  } as unknown as Browser
  return { tab, browser, stopPageSearch, noteHumanInput, onUserInteraction }
}

describe('ending a page search', () => {
  // As Chrome's find bar does when it closes, and Chromium then focuses the link the match is in: an agent's pending
  // action, such as pressing Enter, and the take-over note see that, as with the person's own click in the page.
  it('keeps the active match selected by default, as the person\'s interaction with the page', () => {
    const page = pageSearch()
    stopFindInPage(page.browser, 'tab')
    expect(page.stopPageSearch).toHaveBeenCalledExactlyOnceWith(page.tab.webContents, 'keepSelection')
    expect(page.tab.humanInteractionGeneration).toBe(8)
    expect(page.noteHumanInput).toHaveBeenCalledOnce()
    expect(page.onUserInteraction).toHaveBeenCalledExactlyOnceWith({ tabId: 'tab', workspaceId: 'workspace' })
  })

  it('clears the selection when asked, as emptying the Find field does in Chrome, also over a click', () => {
    const page = pageSearch()
    stopFindInPage(page.browser, 'tab', { clearSelection: true })
    stopFindInPage(page.browser, 'tab', { clearSelection: true, activateMatch: true })
    expect(page.stopPageSearch.mock.calls).toEqual([[page.tab.webContents, 'clearSelection'], [page.tab.webContents, 'clearSelection']])
    expect(page.onUserInteraction).not.toHaveBeenCalled()
  })

  it('clicks the active match when asked, as Ctrl+Enter in Chrome\'s find bar follows the link it is in, as the person\'s click', () => {
    const page = pageSearch()
    stopFindInPage(page.browser, 'tab', { activateMatch: true })
    expect(page.stopPageSearch).toHaveBeenCalledExactlyOnceWith(page.tab.webContents, 'activateSelection')
    // An agent's pending action and the take-over note see the person's click, as with their own click in the page.
    expect(page.tab.humanInteractionGeneration).toBe(8)
    // On the monotonic clock, which the windows after a click and Memory Saver's sleep are timed on.
    expect(page.tab.lastHumanInteractionAt).toBeGreaterThan(1)
    expect(page.tab.lastHumanInteractionAt).toBeLessThanOrEqual(performance.now())
    expect(page.tab.lastActiveAt).toBe(page.tab.lastHumanInteractionAt)
    expect(page.noteHumanInput).toHaveBeenCalledOnce()
    expect(page.onUserInteraction).toHaveBeenCalledExactlyOnceWith({ tabId: 'tab', workspaceId: 'workspace' })
  })

  it('records no interaction when there was no match to select or click', () => {
    const page = pageSearch({ matched: false })
    stopFindInPage(page.browser, 'tab', { activateMatch: true })
    stopFindInPage(page.browser, 'tab')
    expect(page.stopPageSearch.mock.calls).toEqual([[page.tab.webContents, 'activateSelection'], [page.tab.webContents, 'keepSelection']])
    expect(page.tab.humanInteractionGeneration).toBe(7)
    expect(page.noteHumanInput).not.toHaveBeenCalled()
    expect(page.onUserInteraction).not.toHaveBeenCalled()
  })

  it.each([
    ['whose input is locked', { locked: true }],
    ['behind trusted chrome', { occluded: true }],
    ['an agent is sending input to', { agentInput: true }],
    ['with an area capture or element pick in progress', { selecting: true }]
  ])('only ends the search of a page %s, as the person\'s Back key leaves it alone', (_case, options) => {
    const page = pageSearch(options)
    stopFindInPage(page.browser, 'tab', { activateMatch: true })
    // Keeping the match selected would move the page's focus to the link it is in.
    stopFindInPage(page.browser, 'tab')
    expect(page.stopPageSearch.mock.calls).toEqual([[page.tab.webContents, 'clearSelection'], [page.tab.webContents, 'clearSelection']])
    expect(page.tab.humanInteractionGeneration).toBe(7)
    expect(page.onUserInteraction).not.toHaveBeenCalled()
  })

  // Find closes once another document replaces the one it searched, and Chromium then ends the search on the new page,
  // where clearing the selection would clear the page's own, such as the one a page coming back from Back kept.
  it('keeps the selection of a page that replaced the one searched, and clicks nothing there', async () => {
    const page = pageSearch()
    await findInPage(page.browser, 'needle', { tabId: 'tab' })
    page.tab.documentGeneration += 1
    stopFindInPage(page.browser, 'tab', { activateMatch: true })
    expect(page.stopPageSearch).toHaveBeenCalledExactlyOnceWith(page.tab.webContents, 'keepSelection')
    expect(page.onUserInteraction).not.toHaveBeenCalled()
    // A search on the page in view can click its match again when it ends.
    await findInPage(page.browser, 'needle', { tabId: 'tab' })
    stopFindInPage(page.browser, 'tab', { activateMatch: true })
    expect(page.stopPageSearch).toHaveBeenLastCalledWith(page.tab.webContents, 'activateSelection')
    expect(page.onUserInteraction).toHaveBeenCalledOnce()
  })
})

// Chrome finds the match its find bar closed on when it opens again, as the page keeps that match selected, where a
// new search in Chromium goes on from after the selection.
describe('searching from the start of the selection', () => {
  const collapse = [ISOLATED_WORLDS.findFromSelection, [{ code: 'void (getSelection()?.rangeCount ? getSelection().collapseToStart() : undefined)' }]]

  it('collapses the page\'s selection to its start, in a world of its own, before the search', async () => {
    const page = pageSearch()
    const calls: string[] = []
    vi.mocked(page.tab.webContents.executeJavaScriptInIsolatedWorld).mockImplementation(async () => { calls.push('collapse') })
    vi.mocked(page.browser.pageFind.search).mockImplementation(async () => { calls.push('search'); return { activeMatchOrdinal: 2, matches: 3 } })
    expect(await findInPage(page.browser, 'needle', { tabId: 'tab', fromSelectionStart: true })).toEqual({ activeMatchOrdinal: 2, matches: 3 })
    expect(page.tab.webContents.executeJavaScriptInIsolatedWorld).toHaveBeenCalledExactlyOnceWith(...collapse)
    expect(calls).toEqual(['collapse', 'search'])
  })

  it('leaves the selection alone for any other search, and while the page cannot run a script now', async () => {
    const page = pageSearch()
    await findInPage(page.browser, 'needle', { tabId: 'tab' })
    vi.mocked(page.tab.webContents.isLoadingMainFrame).mockReturnValue(true)
    await findInPage(page.browser, 'needle', { tabId: 'tab', fromSelectionStart: true })
    expect(page.tab.webContents.executeJavaScriptInIsolatedWorld).not.toHaveBeenCalled()
    expect(page.browser.pageFind.search).toHaveBeenCalledTimes(2)
  })

  it('searches anyway once a page slow to run the script has had a moment, or the script failed', async () => {
    vi.useFakeTimers()
    const page = pageSearch()
    vi.mocked(page.tab.webContents.executeJavaScriptInIsolatedWorld).mockReturnValueOnce(new Promise(() => undefined))
    const slow = findInPage(page.browser, 'needle', { tabId: 'tab', fromSelectionStart: true })
    await vi.advanceTimersByTimeAsync(299)
    expect(page.browser.pageFind.search).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(await slow).toEqual({ activeMatchOrdinal: 1, matches: 3 })
    expect(vi.getTimerCount()).toBe(0)
    vi.mocked(page.tab.webContents.executeJavaScriptInIsolatedWorld).mockRejectedValueOnce(new Error('Page went away'))
    await findInPage(page.browser, 'needle', { tabId: 'tab', fromSelectionStart: true })
    expect(page.browser.pageFind.search).toHaveBeenCalledTimes(2)
    expect(vi.getTimerCount()).toBe(0)
  })

  // Chrome sends the search for its reopened bar at once, so Enter pressed straight after goes on from the match it
  // found, and Escape keeps that match.
  it('sends a search or the search\'s end asked for while the selection collapses after the search it collapses for', async () => {
    const page = pageSearch()
    const calls: string[] = []
    let collapsed!: () => void
    vi.mocked(page.tab.webContents.executeJavaScriptInIsolatedWorld)
      .mockImplementation(() => new Promise((resolve) => { collapsed = () => { calls.push('collapsed'); resolve(undefined) } }))
    vi.mocked(page.browser.pageFind.search).mockImplementation(async (_page, query, options) => {
      calls.push(`search ${query} ${options.findNext ? 'new' : 'next'}`)
      return { activeMatchOrdinal: 1, matches: 3 }
    })
    page.stopPageSearch.mockImplementation((_page, action) => { calls.push(`stop ${action}`); return true })

    const reopened = findInPage(page.browser, 'needle', { tabId: 'tab', fromSelectionStart: true })
    const next = findInPage(page.browser, 'needle', { tabId: 'tab', findNext: false })
    stopFindInPage(page.browser, 'tab')
    await vi.waitFor(() => expect(page.tab.webContents.executeJavaScriptInIsolatedWorld).toHaveBeenCalledOnce())
    expect(calls).toEqual([])
    collapsed()
    await Promise.all([reopened, next])
    await vi.waitFor(() => expect(calls).toHaveLength(4))
    expect(calls).toEqual(['collapsed', 'search needle new', 'search needle next', 'stop keepSelection'])
    // The match kept is the person's interaction, as for an end not kept waiting.
    expect(page.onUserInteraction).toHaveBeenCalledOnce()

    // Nothing waits once the collapse is over.
    calls.length = 0
    await findInPage(page.browser, 'needle', { tabId: 'tab', findNext: false })
    stopFindInPage(page.browser, 'tab', { clearSelection: true })
    expect(calls).toEqual(['search needle next', 'stop clearSelection'])
  })

  it('sends nothing to a page that went, or a tab that closed, while its selection collapsed', async () => {
    const page = pageSearch()
    let destroyed = false
    Object.assign(page.tab.webContents, { isDestroyed: () => destroyed })
    let collapsed!: () => void
    vi.mocked(page.tab.webContents.executeJavaScriptInIsolatedWorld)
      .mockImplementation(() => new Promise((resolve) => { collapsed = () => resolve(undefined) }))
    const reopened = findInPage(page.browser, 'needle', { tabId: 'tab', fromSelectionStart: true }).catch((error: Error) => error.message)
    stopFindInPage(page.browser, 'tab')
    await vi.waitFor(() => expect(page.tab.webContents.executeJavaScriptInIsolatedWorld).toHaveBeenCalledOnce())
    destroyed = true
    collapsed()
    expect(await reopened).toBe('Page search was cancelled or superseded')
    destroyed = false
    const again = findInPage(page.browser, 'needle', { tabId: 'tab', fromSelectionStart: true })
    stopFindInPage(page.browser, 'tab')
    await vi.waitFor(() => expect(page.tab.webContents.executeJavaScriptInIsolatedWorld).toHaveBeenCalledTimes(2))
    ;(page.browser.tabs as Map<string, unknown>).delete('tab')
    collapsed()
    await again
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(page.browser.pageFind.search).toHaveBeenCalledOnce()
    expect(page.stopPageSearch).not.toHaveBeenCalled()
  })
})
