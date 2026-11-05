import { describe, expect, it, vi } from 'vitest'
import { homeTabsState, runHomeTabAction } from '../src/main/home/home-tabs.js'
import { writeActiveTabId } from '../src/main/browser/tab-selection/active-tab.js'
import { HOME_CARD_ICON_MAX_LENGTH } from '../src/shared/home-workspaces.js'
import { validHomeTabAction } from '../src/shared/home-tabs.js'
import type { BrowserState, BrowserTabState } from '../src/shared/types.js'

// Home's Tabs view acts with the same functions as the tab strip and Settings; these reach the fake browser's stubs.
const { reach } = vi.hoisted(() => ({
  reach: (name: string) => (browser: Record<string, (...args: unknown[]) => unknown>, ...args: unknown[]) => browser[name]!(...args)
}))
vi.mock('../src/main/browser/browser-state/browser-state.js', () => ({ browserState: reach('getState'), buildBrowserState: reach('getState') }))
vi.mock('../src/main/browser/tab-close/close-tabs-for-person.js', () => ({ closeTabsForPerson: reach('closeTabsForPerson') }))
vi.mock('../src/main/browser/tab-selection/person-tab-switch.js', () => ({ selectTabForPerson: reach('selectTabForPerson') }))
vi.mock('../src/main/browser/tab-arrangement/tab-arrangement.js', () => ({ setTabPinned: reach('setTabPinned') }))
vi.mock('../src/main/browser/tab-labels/tab-labels.js', () => ({ saveTabLabel: reach('saveTabLabel') }))
vi.mock('../src/main/browser/tab-reopening/tab-reopening.js', () => ({ reopenClosedTab: reach('reopenClosedTab') }))
vi.mock('../src/main/browser/workspace-archive/workspace-archive.js', () => ({ deleteSavedTabGroup: reach('deleteSavedTabGroup'), restoreSavedTabGroup: reach('restoreSavedTabGroup') }))
vi.mock('../src/main/browser/new-tabs/open-new-tab.js', () => ({ newTab: reach('newTab') }))

const ICON = 'data:image/png;base64,AAAA'
const EMULATION = {
  network: 'none', cacheDisabled: false, bypassServiceWorker: false, dataSaver: 'auto', cpuThrottlingRate: 1, animationPlaybackRate: 1,
  colorScheme: 'auto', reducedMotion: 'auto', mediaType: 'auto', forcedColors: 'auto', contrast: 'auto', reducedTransparency: 'auto',
  visionDeficiency: 'none'
} as const
const frame = (tabId: string, navigationGeneration: number, revision: number) => ({ tabId, navigationGeneration, revision, dataUrl: ICON, width: 4, height: 4 })

function tabState(id: string, overrides: Partial<BrowserTabState> = {}): BrowserTabState {
  return {
    id, title: `Page ${id}`, url: `https://${id}.example.com/`, loading: false, sleeping: false, pinned: false, muted: false, audible: false,
    humanInteractionLocked: false, navigationGeneration: 3, faviconDataUrl: ICON, ...overrides
  } as BrowserTabState
}

function harness(overrides: Partial<BrowserState> = {}) {
  const state = {
    activeTabId: 'home', allHumanInteractionLocked: false,
    mcpTabGroups: [{ id: 'shop', name: 'Shop', color: 'blue', activeTabId: null, description: 'not for Home' }],
    savedTabGroups: [{ id: 'old', name: 'Old', color: 'green', deletionProtected: true, storageOriginCount: 4, tabs: [{ title: 'Board', url: 'https://board.example.com/', label: 'B', faviconDataUrl: ICON }] }],
    closedTabs: [{ id: 'closed', title: 'Gone', url: 'https://ann:secret@gone.example.com/', pinned: true, closedAt: '2026-11-05T01:00:00.000Z', mcpGroupId: 'shop' }],
    tabs: [
      tabState('home', { url: 'hronaut://home/', title: 'Hronaut' }),
      tabState('docs', { mcpGroupId: 'shop', label: 'QA', labelDurabilityUnconfirmed: true }),
      tabState('news', { faviconDataUrl: `data:image/png;base64,${'A'.repeat(HOME_CARD_ICON_MAX_LENGTH)}`, humanInteractionLocked: true, humanInteractionInputLocked: false }),
      tabState('icon', {
        faviconDataUrl: 'https://icon.example.com/favicon.ico',
        emulation: {
          ...EMULATION, userAgent: 'Secret UA/1.0', geolocation: { latitude: 50.45, longitude: 30.52, accuracy: 10 },
          safeAreaInsets: { top: 44 }, extraHttpHeaderNames: ['X-Api-Key', 'X-Tenant'], locale: 'uk-UA'
        }
      })
    ],
    ...overrides
  } as unknown as BrowserState
  const urls = new Map(state.tabs.map(tab => [tab.id, tab.url]))
  const browser = {
    getState: () => state,
    activeTabId: 'home' as string | null,
    // Docs has a frame of its page; the frame of News is from an earlier page.
    tabOverviewPreviews: new Map([['docs', frame('docs', 3, 7)], ['news', frame('news', 2, 8)]]),
    tabOverviewSleepPreviews: new Map(),
    previousPageTabId: 'docs' as string | null,
    mcpActivitiesByTab: new Map([['docs', {}]]),
    tabs: { get: (id: string) => urls.has(id) ? { id, url: urls.get(id) } : undefined },
    closeTabsForPerson: vi.fn(), selectTabForPerson: vi.fn(), setTabPinned: vi.fn(), saveTabLabel: vi.fn(), reopenClosedTab: vi.fn(),
    deleteSavedTabGroup: vi.fn(), restoreSavedTabGroup: vi.fn(), newTab: vi.fn()
  }
  return { state, browser, run: (input: unknown) => runHomeTabAction(browser as never, input) }
}

describe("Home's Tabs view state", () => {
  it('lists website tabs with the fields their cards show, and nothing else', () => {
    const { browser } = harness()
    const result = homeTabsState(browser as never)
    expect(result.tabs.map(tab => tab.id)).toEqual(['docs', 'news', 'icon'])
    expect(result.tabs[0]).toEqual({
      id: 'docs', workspaceId: 'shop', title: 'Page docs', label: 'QA', url: 'https://docs.example.com/', faviconDataUrl: ICON, loading: false,
      sleeping: false, labelDurabilityUnconfirmed: true, pinned: false, muted: false, audible: false, locked: false, agentActive: true, navigationGeneration: 3,
      previewRevision: 7
    })
    expect(result.tabs[1]).not.toHaveProperty('previewRevision')
    expect(result.workspaces).toEqual([{ id: 'shop', name: 'Shop', color: 'blue' }])
    // An address keeps no user name or password written into it.
    expect(result.closedTabs).toEqual([{ id: 'closed', title: 'Gone', url: 'https://gone.example.com/', pinned: true, closedAt: '2026-11-05T01:00:00.000Z' }])
    expect(result.archivedWorkspaces).toEqual([{ id: 'old', name: 'Old', color: 'green', deletionProtected: true, tabs: [{ title: 'Board', label: 'B', url: 'https://board.example.com/' }] }])
    expect(result.previousTabId).toBe('docs')
    expect(result.locked).toBe(false)
  })

  it('names emulated conditions without their values, such as the user agent, location or header names', () => {
    const { browser } = harness()
    const icon = homeTabsState(browser as never).tabs[2]!
    expect(icon.emulation).toEqual({ ...EMULATION, locale: 'uk-UA', userAgent: true, geolocation: true, safeAreaInsets: true, extraHttpHeaderCount: 2 })
    expect(JSON.stringify(homeTabsState(browser as never))).not.toMatch(/Secret UA|50\.45|X-Api-Key|ann|secret/u)
  })

  it('leaves out site icons Home could not show and takes a page input lock over the tab lock', () => {
    const { browser } = harness()
    const [, news, icon] = homeTabsState(browser as never).tabs
    expect(news).not.toHaveProperty('faviconDataUrl')
    expect(icon).not.toHaveProperty('faviconDataUrl')
    expect(news!.locked).toBe(false)
    const locked = harness({ allHumanInteractionLocked: true })
    const [docs, ...rest] = homeTabsState(locked.browser as never).tabs
    expect(docs!.locked).toBe(true)
    expect(rest[0]!.locked).toBe(false)
    expect(homeTabsState(locked.browser as never).locked).toBe(true)
  })

  it('has no previous page once it closed or when it was Home', () => {
    const { browser } = harness()
    browser.previousPageTabId = 'closed-long-ago'
    expect(homeTabsState(browser as never).previousTabId).toBeNull()
    browser.previousPageTabId = 'home'
    expect(homeTabsState(browser as never).previousTabId).toBeNull()
  })

  it('records the page shown before Home as the tab Escape returns to', () => {
    const tabs = new Map([['page', { id: 'page', url: 'https://page.example.com/' }], ['other', { id: 'other', url: 'https://other.example.com/' }], ['home', { id: 'home', url: 'hronaut://home/' }]])
    const browser = { activeTabId: 'page', previousPageTabId: null as string | null, tabs }
    writeActiveTabId(browser as never, 'home')
    expect(browser.previousPageTabId).toBe('page')
    writeActiveTabId(browser as never, 'other')
    expect(browser.previousPageTabId).toBe('page')
    writeActiveTabId(browser as never, 'home')
    expect(browser.previousPageTabId).toBe('other')
  })
})

describe("Home's Tabs view actions", () => {
  it('does each action with the function the tab strip and Settings use, and answers with the tabs after it', async () => {
    const h = harness()
    const answers = await Promise.all([
      h.run({ kind: 'open', tabId: 'docs' }), h.run({ kind: 'close', tabId: 'news' }), h.run({ kind: 'pin', tabId: 'docs', pinned: true }),
      h.run({ kind: 'label', tabId: 'docs', label: 'Checkout' }), h.run({ kind: 'reopen', closedTabId: 'closed' }), h.run({ kind: 'restore', workspaceId: 'old' }),
      h.run({ kind: 'delete', workspaceId: 'old' }), h.run({ kind: 'new-tab' }), h.run({ kind: 'back' })
    ])
    expect(h.browser.selectTabForPerson.mock.calls.map(call => call[0])).toEqual(['docs', 'docs'])
    expect(h.browser.closeTabsForPerson).toHaveBeenCalledWith(['news'])
    expect(h.browser.setTabPinned).toHaveBeenCalledWith('docs', true)
    expect(h.browser.saveTabLabel).toHaveBeenCalledWith('docs', 'Checkout')
    expect(h.browser.reopenClosedTab).toHaveBeenCalledWith('closed')
    expect(h.browser.restoreSavedTabGroup).toHaveBeenCalledWith('old')
    expect(h.browser.deleteSavedTabGroup).toHaveBeenCalledWith('old')
    expect(h.browser.newTab).toHaveBeenCalledWith({ active: true })
    for (const answer of answers) expect(answer.tabs.map(tab => tab.id)).toEqual(['docs', 'news', 'icon'])
  })

  it('refuses Home itself, a tab that closed, and malformed actions before acting', async () => {
    const h = harness()
    await expect(h.run({ kind: 'open', tabId: 'home' })).rejects.toThrow('The tab is no longer available.')
    await expect(h.run({ kind: 'close', tabId: 'gone' })).rejects.toThrow('The tab is no longer available.')
    for (const input of [null, [], {}, { kind: 'bogus' }, { kind: 'open' }, { kind: 'open', tabId: '' }, { kind: 'open', tabId: 'x'.repeat(257) },
      { kind: 'pin', tabId: 'docs', pinned: 'yes' }, { kind: 'label', tabId: 'docs' }, { kind: 'reopen', tabId: 'closed' }, { kind: 'delete' }]) {
      await expect(h.run(input)).rejects.toThrow(TypeError)
    }
    expect(Object.values(h.browser).filter(value => vi.isMockFunction(value)).flatMap(mock => (mock as ReturnType<typeof vi.fn>).mock.calls)).toEqual([])
  })

  it('keeps archived workspaces while the browser is locked', async () => {
    const h = harness({ allHumanInteractionLocked: true })
    await expect(h.run({ kind: 'delete', workspaceId: 'old' })).rejects.toThrow('Unlock all tabs before deleting a workspace.')
    expect(h.browser.deleteSavedTabGroup).not.toHaveBeenCalled()
  })

  it('goes back only to a page that is still open and is not Home, and only while Home is shown', async () => {
    const h = harness()
    h.browser.previousPageTabId = 'home'
    await h.run({ kind: 'back' })
    h.browser.previousPageTabId = null
    await h.run({ kind: 'back' })
    // A tab chosen meanwhile, by the person or an agent, is not undone by a late Escape.
    h.browser.previousPageTabId = 'news'
    h.browser.activeTabId = 'docs'
    await h.run({ kind: 'back' })
    expect(h.browser.selectTabForPerson).not.toHaveBeenCalled()
    h.browser.activeTabId = 'home'
    await h.run({ kind: 'back' })
    expect(h.browser.selectTabForPerson).toHaveBeenCalledWith('news')
  })

  it('carries only the fields of each action', () => {
    expect(validHomeTabAction({ kind: 'open', tabId: 'docs', url: 'https://evil.example/' })).toEqual({ kind: 'open', tabId: 'docs' })
    expect(validHomeTabAction({ kind: 'back', tabId: 'docs' })).toEqual({ kind: 'back' })
  })
})
