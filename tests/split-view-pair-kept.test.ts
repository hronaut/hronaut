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
  focusTabOrTrustedChrome: (browser: { focusTabOrTrustedChrome: (tab: unknown) => void }, tab: unknown) => browser.focusTabOrTrustedChrome(tab),
  // No page has the keyboard as a tab closes.
  keyboardPage: () => null
}))
// Closing a tab ends its selections and stops watching its dialogs, which the browser below stubs; its page lets it close
// at once, out of view while it decides.
vi.mock('../src/main/browser/native-selections/native-selections.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/main/browser/native-selections/native-selections.js')>(),
  cancelNativeSelectionSessions: vi.fn()
}))
vi.mock('../src/main/browser/website-dialogs/website-dialogs.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/main/browser/website-dialogs/website-dialogs.js')>(),
  detachDialogMonitoring: vi.fn()
}))
vi.mock('../src/main/browser/tab-close/before-unload-close.js', () => ({ attemptBeforeUnloadClose: vi.fn(async () => 'closed') }))
vi.mock('../src/main/browser/tab-close/before-unload-staging.js', () => ({
  stageBeforeUnloadClose: (browser: { window: { contentView: { removeChildView: (view: unknown) => void } } }, tab: { view: unknown }) => {
    browser.window.contentView.removeChildView(tab.view)
    return { targetDetached: true, cleanup: () => undefined, rollback: () => undefined }
  }
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
import { closeTab } from '../src/main/browser/tab-close/close-tab.js'
import { removeTabRecord } from '../src/main/browser/tab-close/remove-tab-record.js'
import { recoverFromDestroyedPage } from '../src/main/browser/tab-events/page-destroyed-events.js'
import { selectTabAndWait } from '../src/main/browser/tab-selection/tab-selection.js'

// Selecting a third tab ended a split view for good: going back to either of its tabs showed it alone, and its layout
// was lost. As in Chrome, the two tabs now stay paired, and selecting either of them shows both again.

interface Tab {
  id: string
  url: string
  title: string
  pinned: boolean
  mcpGroupId: string
  sleeping: boolean
  lastActiveAt: number
  navigationGeneration: number
  view: { id: string }
  webContents: { id: number; destroyed: boolean; isDestroyed: () => boolean; close: () => void }
}

function page(id: string, number: number): Tab {
  const webContents = { id: number, destroyed: false, isDestroyed: () => webContents.destroyed, close: vi.fn() }
  return {
    id, url: `https://example.test/${id}`, title: id, pinned: false, mcpGroupId: 'workspace', sleeping: false, lastActiveAt: 0,
    navigationGeneration: 0, view: { id }, webContents
  }
}

const forgets = () => ({ forget: vi.fn() })

/** Four website tabs of one workspace, the first in view, and which of their pages the window shows. */
function browser() {
  const tabs = new Map(['alpha', 'beta', 'gamma', 'delta'].map((id, index) => [id, page(id, index + 1)]))
  const shown = new Set<string>()
  const manager = Object.assign(Object.create(Browser.prototype), {
    destroyed: false, tabs,
    mcpTabGroups: new Map([['workspace', { id: 'workspace', activeTabId: 'alpha' }], ['other', { id: 'other', activeTabId: null }]]),
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
    browserSessionAuthorityHooks: new Map(), mcpActivitiesByTab: new Map(), mcpActivityFollower: { removeTab: vi.fn() },
    // What closing a tab reaches besides.
    pendingHumanTabCloses: new Map(), expectedTabClosures: new Set(), closedTabs: [], detachedClosedTabs: new Set(),
    pendingTabLabels: new Set(), tabLabelLifecycleHolds: 0, tabLabelAdmissionClosed: false,
    networkWaitController: { reject: vi.fn() }, reproRecorder: { clearReproRecording: vi.fn() }, videoRecorder: { clear: vi.fn() },
    navigationHistorySnapshot: () => ({ entries: [], index: 0 })
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
    // Should a tab of the pair be in view alone, selecting the other shows both, without attaching that one twice.
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

  it('keeps the proportion from before a drag still under way', () => {
    const { manager } = browser()
    openSplitView(manager, 'beta')
    updateSplitView(manager, { orientation: 'vertical', ratio: 0.7 })
    manager.splitDivider.persistedRatio = () => 0.4

    manager.selectTab('gamma')
    expect(manager.restingSplitViews).toEqual([{ firstTabId: 'alpha', secondTabId: 'beta', orientation: 'vertical', ratio: 0.4 }])
  })

  it('wakes the tab paired with the tab selected without waiting for it, as a new split view of the pair', () => {
    const { manager, tabs, inView } = browser()
    openSplitView(manager, 'beta')
    manager.selectTab('gamma')
    const alpha = tabs.get('alpha')!
    alpha.sleeping = true
    alpha.lastActiveAt = 0
    const generation = manager.splitViewGeneration

    manager.selectTab('beta')
    expect(manager.wakeTab).toHaveBeenCalledWith('alpha')
    // Memory Saver counts the tab in view again from now.
    expect(alpha.lastActiveAt).toBeGreaterThan(0)
    // Work for the split view shown before, such as keeping the keyboard from a loading pane, stops.
    expect(manager.splitViewGeneration).toBe(generation + 1)
    expect(inView()).toEqual(['alpha', 'beta'])
  })

  it('starts waking the tab paired with a tab that wakes before it shows', async () => {
    const { manager, tabs, inView } = browser()
    openSplitView(manager, 'beta')
    manager.selectTab('gamma')
    tabs.get('alpha')!.sleeping = true
    tabs.get('beta')!.sleeping = true
    let restored!: () => void
    const woken: string[] = []
    manager.wakeTab = vi.fn((tabId: string) => {
      woken.push(tabId)
      return tabId === 'beta' ? new Promise((resolve) => { restored = () => resolve({}) }) : Promise.resolve({})
    }) as never

    const selecting = selectTabAndWait(manager, 'beta')
    // Both tabs restore together rather than one after the other.
    expect(woken).toEqual(['alpha', 'beta'])
    tabs.get('beta')!.sleeping = false
    restored()
    await selecting
    expect(manager.splitView).toMatchObject({ firstTabId: 'alpha', secondTabId: 'beta' })
    expect(inView()).toEqual(['alpha', 'beta'])
  })

  it('keeps tabs of two workspaces paired, as the split view shows them', () => {
    const { manager, tabs, inView } = browser()
    tabs.get('beta')!.mcpGroupId = 'other'
    openSplitView(manager, 'beta')
    manager.selectTab('gamma')

    manager.selectTab('alpha')
    expect(manager.splitView).toMatchObject({ firstTabId: 'alpha', secondTabId: 'beta' })
    expect(inView()).toEqual(['alpha', 'beta'])
  })

  it('ends when either tab shows Home', () => {
    const { manager, tabs, inView } = browser()
    openSplitView(manager, 'beta')
    manager.selectTab('gamma')
    tabs.get('beta')!.url = 'hronaut://home/'

    manager.selectTab('alpha')
    expect(manager.splitView).toBeNull()
    expect(manager.restingSplitViews).toEqual([])
    expect(inView()).toEqual(['alpha'])
  })

  it('does not bring a closing tab back beside the tab shown in its place', async () => {
    const { manager, inView } = browser()
    // The tab in view is paired with the tab that follows it in the strip, which shows when it closes.
    manager.restingSplitViews = [{ firstTabId: 'alpha', secondTabId: 'beta', orientation: 'vertical', ratio: 0.5 }]

    await closeTab(manager, 'alpha', true)
    expect(manager.activeTabId).toBe('beta')
    expect(manager.splitView).toBeNull()
    expect(manager.restingSplitViews).toEqual([])
    expect(inView()).toEqual(['beta'])
  })

  it('shows the pair of the tab shown in place of a tab whose page let it close', async () => {
    const { manager, inView } = browser()
    manager.selectTab('beta')
    openSplitView(manager, 'gamma')
    manager.selectTab('alpha')

    // The page is asked whether it may close, and the tab after it shows in its place.
    await closeTab(manager, 'alpha', true, true)
    expect(manager.activeTabId).toBe('beta')
    expect(manager.splitView).toMatchObject({ firstTabId: 'beta', secondTabId: 'gamma' })
    expect(manager.restingSplitViews).toEqual([])
    expect(inView()).toEqual(['beta', 'gamma'])
  })
})
