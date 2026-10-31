import { describe, expect, it, vi } from 'vitest'
import type { WebContents } from 'electron'

vi.mock('electron', () => ({ app: { isPackaged: false } }))

const { findInPage, stopFindInPage } = await import('../src/main/browser/page-find/page-find.js')
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
    webContents: { id: 4 } as WebContents,
    humanInteractionGeneration: 7,
    lastHumanInteractionAt: 1,
    lastActiveAt: 1,
    documentGeneration: 0
  }
  // The controller clicks only after a search settled on a match.
  const stopPageSearch = vi.fn((_webContents: WebContents, action: 'clearSelection' | 'keepSelection' | 'activateSelection') => (
    action === 'activateSelection' && (options.matched ?? true)
  ))
  const noteHumanInput = vi.fn()
  const onUserInteraction = vi.fn()
  const browser = {
    tabs: new Map([[tab.id, tab]]),
    pageFind: { search: vi.fn(), stop: stopPageSearch },
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
  it('clears the selection by default', () => {
    const page = pageSearch()
    stopFindInPage(page.browser, 'tab')
    expect(page.stopPageSearch).toHaveBeenCalledExactlyOnceWith(page.tab.webContents, 'clearSelection')
    expect(page.tab.humanInteractionGeneration).toBe(7)
    expect(page.noteHumanInput).not.toHaveBeenCalled()
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

  it('records no interaction when there was no match to click', () => {
    const page = pageSearch({ matched: false })
    stopFindInPage(page.browser, 'tab', { activateMatch: true })
    expect(page.stopPageSearch).toHaveBeenCalledExactlyOnceWith(page.tab.webContents, 'activateSelection')
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
    expect(page.stopPageSearch).toHaveBeenCalledExactlyOnceWith(page.tab.webContents, 'clearSelection')
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
    // A search on the page in view clears its selection again when it ends.
    await findInPage(page.browser, 'needle', { tabId: 'tab' })
    stopFindInPage(page.browser, 'tab')
    expect(page.stopPageSearch).toHaveBeenLastCalledWith(page.tab.webContents, 'clearSelection')
  })
})
