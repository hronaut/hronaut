import { describe, expect, it, vi } from 'vitest'
vi.mock('electron', () => ({ session: {}, WebContentsView: class {}, nativeImage: {}, shell: {}, app: { getPath: () => '/tmp' }, powerMonitor: { on: () => undefined } }))
// The prototype-built browser below stubs changed, getState and focusTabOrTrustedChrome, which selecting a tab and the
// split view reach through these.
vi.mock('../src/main/browser/browser-state/browser-state.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/main/browser/browser-state/browser-state.js')>(),
  publishChange: (browser: { changed: (persist?: boolean) => void }, persist?: boolean) => browser.changed(persist),
  browserState: (browser: { getState: () => unknown }) => browser.getState()
}))
vi.mock('../src/main/browser/trusted-chrome-focus/trusted-chrome-focus.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/main/browser/trusted-chrome-focus/trusted-chrome-focus.js')>(),
  focusTabOrTrustedChrome: (browser: { focusTabOrTrustedChrome: (tab: unknown) => void }, tab: unknown) => browser.focusTabOrTrustedChrome(tab)
}))
// Closing a tab drops its overview preview and cancels its wallet requests, which the browser below stubs.
vi.mock('../src/main/browser/tab-overview-previews/tab-overview-previews.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/main/browser/tab-overview-previews/tab-overview-previews.js')>(),
  invalidateTabOverviewPreview: vi.fn()
}))
vi.mock('../src/main/browser/background-action.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/main/browser/background-action.js')>(),
  runWalletLifecycleAction: vi.fn()
}))
import { Browser } from '../src/main/browser/browser.js'
import { closeSplitView, openSplitView, updateSplitView } from '../src/main/browser/split-view/split-view.js'
import { removeTabRecord } from '../src/main/browser/tab-close/remove-tab-record.js'
import { recoverFromDestroyedPage } from '../src/main/browser/tab-events/page-destroyed-events.js'

// Selecting a third tab ended a split view for good: going back to either of its tabs showed it alone, and its layout
// was lost. As in Chrome, the two tabs now stay paired, and selecting either of them shows both again.

interface Tab {
  id: string
  url: string
  mcpGroupId: string
  sleeping: boolean
  lastActiveAt: number
  view: { id: string }
  webContents: { id: number; destroyed: boolean; isDestroyed: () => boolean }
}

function page(id: string, number: number): Tab {
  const webContents = { id: number, destroyed: false, isDestroyed: () => webContents.destroyed }
  return { id, url: `https://example.test/${id}`, mcpGroupId: 'workspace', sleeping: false, lastActiveAt: 0, view: { id }, webContents }
}

const forgets = () => ({ forget: vi.fn() })

/** Four website tabs of one workspace, the first in view, and which of their pages the window shows. */
function browser() {
  const tabs = new Map(['alpha', 'beta', 'gamma', 'delta'].map((id, index) => [id, page(id, index + 1)]))
  const shown = new Set<string>()
  const manager = Object.assign(Object.create(Browser.prototype), {
    destroyed: false, tabs, mcpTabGroups: new Map([['workspace', { id: 'workspace', activeTabId: 'alpha' }]]),
    webContentsToTab: new Map(), activeTabId: null, previousPageTabId: null, splitView: null, restingSplitViews: [],
    tabSelectionGeneration: 0, splitViewGeneration: 0,
    window: {
      isDestroyed: () => false,
      contentView: {
        addChildView: (view: { id: string }) => { shown.add(view.id) },
        removeChildView: (view: { id: string }) => { shown.delete(view.id) }
      }
    },
    splitDivider: { cancel: vi.fn(), persistedRatio: (ratio: number) => ratio },
    wakeTab: vi.fn(async () => ({})), layout: vi.fn(), focusTabOrTrustedChrome: vi.fn(), changed: vi.fn(), getState: () => ({}),
    text: (key: string) => key, options: {},
    // What closing a tab forgets of it.
    cssStatePreview: forgets(), virtualPasskeys: forgets(), domMutationSource: forgets(), logpoints: forgets(), workerEvaluations: forgets(),
    tabOverviewSleepPreviews: new Map(), tabOverviewPreviewCaptures: { cancelPending: vi.fn() }, snapshotBaselines: new Map(),
    snapshotBaselineIdsByTab: new Map(), globallyUnlockedTabIds: new Set(), globallyResumedAgentTabIds: new Set(),
    browserSessionAuthorityHooks: new Map(), mcpActivitiesByTab: new Map(), mcpActivityFollower: { removeTab: vi.fn() }
  }) as Browser
  manager.selectTab('alpha')
  const inView = () => [...shown].sort()
  return { manager, tabs, inView }
}

describe('a split view put aside', () => {
  it('shows both tabs again, in the same layout, when either of them is selected', () => {
    const { manager, inView } = browser()
    openSplitView(manager, 'beta')
    updateSplitView(manager, { orientation: 'horizontal', ratio: 0.3 })

    manager.selectTab('gamma')
    expect(manager.splitView).toBeNull()
    expect(manager.restingSplitViews).toEqual([{ firstTabId: 'alpha', secondTabId: 'beta', orientation: 'horizontal', ratio: 0.3 }])
    expect(inView()).toEqual(['gamma'])

    // The tab selected becomes the active pane.
    manager.selectTab('beta')
    expect(manager.splitView).toEqual({ firstTabId: 'alpha', secondTabId: 'beta', orientation: 'horizontal', ratio: 0.3 })
    expect(manager.activeTabId).toBe('beta')
    expect(manager.restingSplitViews).toEqual([])
    expect(inView()).toEqual(['alpha', 'beta'])
  })

  it('keeps each of several pairs, and puts the one in view aside as another shows', () => {
    const { manager, inView } = browser()
    openSplitView(manager, 'beta')
    manager.selectTab('gamma')
    openSplitView(manager, 'delta')

    manager.selectTab('alpha')
    expect(manager.splitView).toMatchObject({ firstTabId: 'alpha', secondTabId: 'beta' })
    expect(manager.restingSplitViews).toEqual([{ firstTabId: 'gamma', secondTabId: 'delta', orientation: 'vertical', ratio: 0.5 }])
    expect(inView()).toEqual(['alpha', 'beta'])

    manager.selectTab('delta')
    expect(manager.splitView).toMatchObject({ firstTabId: 'gamma', secondTabId: 'delta' })
    expect(manager.activeTabId).toBe('delta')
    expect(inView()).toEqual(['delta', 'gamma'])
  })

  it('shows its pair beside a tab of it that came into view alone', () => {
    const { manager, inView } = browser()
    openSplitView(manager, 'beta')
    manager.selectTab('gamma')
    // A tab shown without being selected, such as the one a closed tab hands over to, shows alone.
    manager.window.contentView.removeChildView(manager.tabs.get('gamma')!.view as never)
    manager.window.contentView.addChildView(manager.tabs.get('alpha')!.view as never)
    manager.activeTabId = 'alpha'

    manager.selectTab('beta')
    expect(manager.splitView).toMatchObject({ firstTabId: 'alpha', secondTabId: 'beta' })
    expect(inView()).toEqual(['alpha', 'beta'])
  })

  it('ends when the person returns it to one page or opens either tab in another split view', () => {
    const returned = browser()
    openSplitView(returned.manager, 'beta')
    closeSplitView(returned.manager)
    returned.manager.selectTab('gamma')
    returned.manager.selectTab('beta')
    expect(returned.manager.splitView).toBeNull()
    expect(returned.inView()).toEqual(['beta'])

    const reopened = browser()
    openSplitView(reopened.manager, 'beta')
    reopened.manager.selectTab('gamma')
    openSplitView(reopened.manager, 'alpha')
    expect(reopened.manager.restingSplitViews).toEqual([])
    reopened.manager.selectTab('beta')
    expect(reopened.manager.splitView).toBeNull()
    expect(reopened.inView()).toEqual(['beta'])
  })

  it('ends when either tab closes or its page is gone', () => {
    const { manager, tabs, inView } = browser()
    openSplitView(manager, 'beta')
    manager.selectTab('gamma')
    openSplitView(manager, 'delta')
    manager.selectTab('alpha')
    removeTabRecord(manager, tabs.get('gamma') as never)
    expect(manager.restingSplitViews).toEqual([])
    manager.selectTab('delta')
    expect(manager.splitView).toBeNull()
    expect(inView()).toEqual(['delta'])

    openSplitView(manager, 'alpha')
    manager.selectTab('beta')
    tabs.get('alpha')!.webContents.destroyed = true
    recoverFromDestroyedPage(manager, tabs.get('alpha') as never)
    expect(manager.restingSplitViews).toEqual([])
  })

  it('shows a tab alone when the tab paired with it can no longer show beside it', () => {
    const { manager, tabs, inView } = browser()
    openSplitView(manager, 'beta')
    manager.selectTab('gamma')
    tabs.get('beta')!.webContents.destroyed = true

    manager.selectTab('alpha')
    expect(manager.splitView).toBeNull()
    expect(manager.restingSplitViews).toEqual([])
    expect(inView()).toEqual(['alpha'])
  })
})
