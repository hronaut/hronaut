import { EventEmitter } from 'node:events'
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
  keyboardPage: () => null,
  // A tab left with a field that had the keyboard gives it back as it shows again.
  returnTabFieldFocus: (_browser: unknown, tab: { fieldFocusOnReturn?: unknown }) => {
    const returned = tab.fieldFocusOnReturn !== undefined
    tab.fieldFocusOnReturn = undefined
    return returned
  }
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
import { showRestoredTab } from '../src/main/browser/browser-lifecycle/show-restored-tab.js'
import { restoreRestingSplitViews } from '../src/main/browser/split-view/resting-split-views.js'
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
  webContents: EventEmitter & {
    id: number
    destroyed: boolean
    /** The page's address, empty until its first document loads, as for a tab restored asleep. */
    url: string
    focused: boolean
    isDestroyed: () => boolean
    close: () => void
  }
}

function page(id: string, number: number): Tab {
  const webContents = Object.assign(new EventEmitter(), {
    id: number, destroyed: false, url: `https://example.test/${id}`, focused: false, isDestroyed: () => webContents.destroyed,
    close: vi.fn(), getURL: () => webContents.url, isLoadingMainFrame: () => false, isFocused: () => webContents.focused
  })
  return {
    id, url: `https://example.test/${id}`, title: id, pinned: false, mcpGroupId: 'workspace', sleeping: false, lastActiveAt: 0,
    navigationGeneration: 0, view: { id }, webContents
  }
}

const forgets = () => ({ forget: vi.fn() })
/** The browser's stub that gives a tab, or Hronaut's own controls, the keyboard. */
const focusTab = (manager: Browser) => (manager as unknown as { focusTabOrTrustedChrome: ReturnType<typeof vi.fn> }).focusTabOrTrustedChrome

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
      isFocused: () => true,
      webContents: Object.assign(new EventEmitter(), { focus: vi.fn(), send: vi.fn(), isDestroyed: () => false }),
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
    const { manager, tabs, inView } = browser()
    manager.selectTab('beta')
    openSplitView(manager, 'gamma')
    manager.selectTab('alpha')

    // The page is asked whether it may close, and the tab after it shows in its place, its pair still loading.
    tabs.get('gamma')!.webContents.url = ''
    await closeTab(manager, 'alpha', true, true)
    expect(manager.activeTabId).toBe('beta')
    expect(manager.splitView).toMatchObject({ firstTabId: 'beta', secondTabId: 'gamma' })
    expect(manager.restingSplitViews).toEqual([])
    expect(inView()).toEqual(['beta', 'gamma'])

    // The keyboard the tab shown got stays with it.
    focusTab(manager).mockClear()
    tabs.get('gamma')!.webContents.focused = true
    tabs.get('gamma')!.webContents.emit('focus')
    await new Promise((resolve) => setImmediate(resolve))
    expect(focusTab(manager)).toHaveBeenCalledWith(tabs.get('beta'))
  })

  it('gives the keyboard back to the field the tab shown in place of a closed tab was left with', async () => {
    const { manager, tabs } = browser()
    manager.selectTab('beta')
    openSplitView(manager, 'gamma')
    manager.selectTab('alpha')
    tabs.get('gamma')!.webContents.url = ''
    // The person left beta with its address field focused, which gets the keyboard back as beta shows in alpha's place.
    Object.assign(tabs.get('beta')!, { fieldFocusOnReturn: 'address' })
    await closeTab(manager, 'alpha', true, true)
    expect(manager.activeTabId).toBe('beta')
    expect(manager.splitView).toMatchObject({ firstTabId: 'beta', secondTabId: 'gamma' })
    focusTab(manager).mockClear()

    const gamma = tabs.get('gamma')!
    gamma.webContents.focused = true
    gamma.webContents.emit('focus')
    await new Promise((resolve) => setImmediate(resolve))
    expect(manager.window.webContents.focus).toHaveBeenCalledOnce()
    expect(manager.window.webContents.send).toHaveBeenCalledExactlyOnceWith('shell:keyboard-given-back')
    expect(focusTab(manager)).not.toHaveBeenCalled()
  })

  it('keeps the keyboard from the tab paired with the tab selected while that tab loads its first document', async () => {
    const { manager, tabs } = browser()
    openSplitView(manager, 'beta')
    manager.selectTab('gamma')
    // Restored asleep after a restart, the tab paired with beta has no page yet.
    const alpha = tabs.get('alpha')!
    alpha.sleeping = true
    alpha.webContents.url = ''
    manager.selectTab('beta')
    focusTab(manager).mockClear()

    // Its page takes the keyboard as its view first shows, and the tab the person selected gets it back.
    alpha.webContents.focused = true
    alpha.webContents.emit('focus')
    await new Promise((resolve) => setImmediate(resolve))
    expect(focusTab(manager)).toHaveBeenCalledWith(tabs.get('beta'))

    // Once its document arrives, the page may have the keyboard.
    alpha.webContents.emit('did-navigate')
    focusTab(manager).mockClear()
    alpha.webContents.emit('focus')
    await new Promise((resolve) => setImmediate(resolve))
    expect(focusTab(manager)).not.toHaveBeenCalled()
  })

  it('gives the keyboard back to the field the tab selected was left with, should its loading partner take it', async () => {
    const { manager, tabs } = browser()
    openSplitView(manager, 'beta')
    manager.selectTab('gamma')
    tabs.get('alpha')!.webContents.url = ''
    // The person left beta with its address field focused, which gets the keyboard back as beta shows again.
    Object.assign(tabs.get('beta')!, { fieldFocusOnReturn: 'address' })
    manager.selectTab('beta')
    focusTab(manager).mockClear()

    const alpha = tabs.get('alpha')!
    alpha.webContents.focused = true
    alpha.webContents.emit('focus')
    await new Promise((resolve) => setImmediate(resolve))
    expect(manager.window.webContents.focus).toHaveBeenCalled()
    expect(focusTab(manager)).not.toHaveBeenCalled()
  })

  it('gives the keyboard back where the person put it since the pair showed', async () => {
    const { manager, tabs } = browser()
    openSplitView(manager, 'beta')
    manager.selectTab('gamma')
    const alpha = tabs.get('alpha')!
    alpha.webContents.url = ''
    manager.selectTab('beta', { focus: false })
    // The person then clicks into beta's page, as after answering its question to stay.
    tabs.get('beta')!.webContents.emit('focus')
    focusTab(manager).mockClear()

    alpha.webContents.focused = true
    alpha.webContents.emit('focus')
    await new Promise((resolve) => setImmediate(resolve))
    expect(focusTab(manager)).toHaveBeenCalledWith(tabs.get('beta'))
    expect(manager.window.webContents.focus).not.toHaveBeenCalled()

    // And then into the address field, while the page still loads.
    alpha.webContents.focused = false
    ;(manager.window.webContents as unknown as EventEmitter).emit('focus')
    focusTab(manager).mockClear()
    alpha.webContents.focused = true
    alpha.webContents.emit('focus')
    await new Promise((resolve) => setImmediate(resolve))
    expect(manager.window.webContents.focus).toHaveBeenCalled()
    expect(focusTab(manager)).not.toHaveBeenCalled()
  })

  it('leaves the keyboard in Hronaut\'s controls when a pair shows for a tab selected without it', async () => {
    const { manager, tabs } = browser()
    openSplitView(manager, 'beta')
    manager.selectTab('gamma')
    const alpha = tabs.get('alpha')!
    alpha.webContents.url = ''
    // Follow agents shows a tab without giving it the keyboard.
    manager.selectTab('beta', { focus: false })
    focusTab(manager).mockClear()

    alpha.webContents.focused = true
    alpha.webContents.emit('focus')
    await new Promise((resolve) => setImmediate(resolve))
    expect(manager.window.webContents.focus).toHaveBeenCalled()
    expect(focusTab(manager)).not.toHaveBeenCalled()
  })

  it('comes back after a restart, so the tab shown first shows with its pair', () => {
    const { manager, tabs, inView } = browser()
    tabs.set('epsilon', page('epsilon', 5))
    tabs.set('zeta', page('zeta', 6))
    tabs.get('beta')!.url = 'hronaut://home/'
    const kept = { firstTabId: 'gamma', secondTabId: 'delta', orientation: 'horizontal' as const, ratio: 0.3 }
    const shown = { firstTabId: 'alpha', secondTabId: 'theta', orientation: 'vertical' as const, ratio: 0.5 }
    // A pair with a tab that did not come back, with Home, or with a tab of the split view saved in view is left out.
    restoreRestingSplitViews(manager, [
      kept,
      { firstTabId: 'epsilon', secondTabId: 'missing', orientation: 'vertical', ratio: 0.5 },
      { firstTabId: 'beta', secondTabId: 'epsilon', orientation: 'vertical', ratio: 0.5 },
      { firstTabId: 'zeta', secondTabId: 'alpha', orientation: 'vertical', ratio: 0.5 }
    ], shown)
    expect(manager.restingSplitViews).toEqual([kept])
    expect(manager.restingSplitViews[0]).not.toBe(kept)

    manager.selectTab('delta')
    expect(manager.splitView).toEqual(kept)
    expect(inView()).toEqual(['delta', 'gamma'])
  })

  it('shows the tab shown as Hronaut starts with its pair, or with the split view saved in view', () => {
    const paired = browser()
    const kept = { firstTabId: 'gamma', secondTabId: 'delta', orientation: 'horizontal' as const, ratio: 0.3 }
    showRestoredTab(paired.manager, 'delta', { restingSplitViews: [kept] })
    expect(paired.manager.activeTabId).toBe('delta')
    expect(paired.manager.splitView).toEqual(kept)
    expect(paired.manager.restingSplitViews).toEqual([])
    expect(paired.inView()).toEqual(['delta', 'gamma'])

    const shown = browser()
    const split = { firstTabId: 'beta', secondTabId: 'gamma', orientation: 'vertical' as const, ratio: 0.6 }
    showRestoredTab(shown.manager, 'gamma', { splitView: split, restingSplitViews: [kept] })
    expect(shown.manager.splitView).toEqual(split)
    expect(shown.manager.restingSplitViews).toEqual([])
    expect(shown.inView()).toEqual(['beta', 'gamma'])
  })
})
