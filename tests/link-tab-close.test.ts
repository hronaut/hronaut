import { describe, expect, it, vi } from 'vitest'
vi.mock('electron', () => ({ session: {}, WebContentsView: class {}, nativeImage: {}, shell: {}, app: { getPath: () => '/tmp' }, Menu: {} }))
import { BrowserTabsManager } from '../src/main/browser/tabs-manager.js'

// Closing a tab opened from a page's link showed the tab to its right, where Chrome shows the page's next tab or the
// page itself; a workspace whose remembered tab closed off screen remembered that tab too.

interface Tab {
  id: string; url: string; pinned: boolean; mcpGroupId: string; openedFromTabId?: string; openerTabId?: string
  webContents: { id: number; isDestroyed: () => boolean }
}
interface Internals {
  activeTabId: string | null
  tabs: Map<string, Tab>
  mcpTabGroups: Map<string, { id: string; activeTabId: string | null; lastUsedAt: string }>
  closeTabTransition(tab: Tab): { splitPartnerId: string | null; nextId: string | undefined }
  removeTabRecord(tab: Tab): void
  selectTabForPerson(tabId: string): Promise<unknown>
  selectTabAndWait(tabId: string): Promise<unknown>
}

const forgets = () => ({ forget: vi.fn() })

function fixture(spec: Array<{ id: string; from?: string; workspace?: string }>, remembered: string | null = null) {
  const group = (id: string) => ({ id, name: id, activeTabId: id === 'work' ? remembered : null, lastUsedAt: '2026-10-22T06:00:00.000Z' })
  return Object.assign(Object.create(BrowserTabsManager.prototype), {
    mcpTabGroups: new Map([['work', group('work')], ['other', group('other')]]),
    tabs: new Map(spec.map((tab, index) => [tab.id, {
      id: tab.id, url: `https://${tab.id}.example/`, pinned: false, mcpGroupId: tab.workspace ?? 'work',
      ...(tab.from ? { openedFromTabId: tab.from } : {}),
      webContents: { id: index + 1, isDestroyed: () => false }
    }])),
    activeTabId: null,
    splitView: null,
    cssStatePreview: forgets(), virtualPasskeys: forgets(), domMutationSource: forgets(), logpoints: forgets(), workerEvaluations: forgets(),
    invalidateTabOverviewPreview: vi.fn(), tabOverviewSleepPreviews: new Map(), tabOverviewPreviewCaptures: { cancelPending: vi.fn() },
    tabOverviewPreviewableTabs: new Set(), runWalletLifecycleAction: vi.fn(), options: {}, deleteSnapshotBaselineForTab: vi.fn(),
    globallyUnlockedTabIds: new Set(), globallyResumedAgentTabIds: new Set(), browserSessionAuthorityHooks: new Map(),
    mcpActivitiesByTab: new Map(), mcpActivityFollower: { removeTab: vi.fn() }, webContentsToTab: new Map()
  }) as unknown as Internals
}

function closeShown(manager: Internals, id: string): string | undefined {
  manager.activeTabId = id
  const { nextId } = manager.closeTabTransition(manager.tabs.get(id)!)
  manager.removeTabRecord(manager.tabs.get(id)!)
  return nextId
}

describe('closing the shown tab opened from a page', () => {
  it('shows the page\'s next tab, then the page, rather than the tab to its right', () => {
    const manager = fixture([{ id: 'app' }, { id: 'one', from: 'app' }, { id: 'two', from: 'app' }, { id: 'mail' }])
    expect(closeShown(manager, 'one')).toBe('two')
    expect(closeShown(manager, 'two')).toBe('app')
  })

  it('counts the tabs it opened among the page\'s, which the page then owns', () => {
    const manager = fixture([{ id: 'app' }, { id: 'one', from: 'app' }, { id: 'child', from: 'one' }, { id: 'mail' }])
    expect(closeShown(manager, 'one')).toBe('child')
    expect(manager.tabs.get('child')!.openedFromTabId).toBe('app')
    expect(closeShown(manager, 'child')).toBe('app')
  })

  it('shows the tab beside it once the page is closed, as for any tab', () => {
    const manager = fixture([{ id: 'app' }, { id: 'one', from: 'app' }, { id: 'mail' }])
    manager.removeTabRecord(manager.tabs.get('app')!)
    expect(manager.tabs.get('one')).not.toHaveProperty('openedFromTabId')
    expect(closeShown(manager, 'one')).toBe('mail')
  })

  it('still shows a popup\'s opener first', () => {
    const manager = fixture([{ id: 'app' }, { id: 'popup', from: 'app' }, { id: 'one', from: 'app' }])
    manager.tabs.get('popup')!.openerTabId = 'app'
    expect(closeShown(manager, 'popup')).toBe('app')
  })
})

describe('a workspace whose remembered tab opened from a page closes off screen', () => {
  it('remembers the tab closing it on screen would show', () => {
    const manager = fixture([{ id: 'app' }, { id: 'one', from: 'app' }, { id: 'mail' }, { id: 'shown', workspace: 'other' }], 'one')
    manager.activeTabId = 'shown'
    manager.removeTabRecord(manager.tabs.get('one')!)
    expect(manager.mcpTabGroups.get('work')!.activeTabId).toBe('app')
  })
})

describe('the person going to another tab', () => {
  function switching(from: string, to: string) {
    const manager = fixture([{ id: 'app' }, { id: 'one', from: 'app' }, { id: 'mail' }, { id: 'elsewhere', from: 'mail', workspace: 'other' }])
    manager.activeTabId = from
    manager.selectTabAndWait = vi.fn(async () => undefined)
    void manager.selectTabForPerson(to)
    expect(manager.selectTabAndWait).toHaveBeenCalledWith(to)
    return manager
  }

  it('forgets which page opened the workspace\'s tabs when the tabs are unrelated, as in Chrome', () => {
    const manager = switching('mail', 'one')
    expect(manager.tabs.get('one')).not.toHaveProperty('openedFromTabId')
    expect(manager.tabs.get('elsewhere')!.openedFromTabId).toBe('mail')
  })

  it('keeps it between a page and the tabs it opened, and for another workspace', () => {
    expect(switching('app', 'one').tabs.get('one')!.openedFromTabId).toBe('app')
    expect(switching('one', 'app').tabs.get('one')!.openedFromTabId).toBe('app')
    expect(switching('one', 'elsewhere').tabs.get('one')!.openedFromTabId).toBe('app')
  })
})
