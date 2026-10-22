import { describe, expect, it, vi } from 'vitest'
vi.mock('electron', () => ({ session: {}, WebContentsView: class {}, nativeImage: {}, shell: {}, app: { getPath: () => '/tmp' }, Menu: {} }))
import { BrowserTabsManager } from '../src/main/browser/tabs-manager.js'

// A new tab from + or Ctrl/Cmd+T, closed right away, showed the tab beside it (the workspace's last tab), where Chrome
// shows the tab the person was on.

interface Tab {
  id: string; url: string; pinned: boolean; mcpGroupId?: string; returnsToTabId?: string
  webContents: { id: number; isDestroyed: () => boolean }
}
interface Internals {
  activeTabId: string | null
  tabs: Map<string, Tab>
  mcpTabGroups: Map<string, { id: string; activeTabId: string | null; lastUsedAt: string }>
  createNewTab: (options: unknown, selectVisible: boolean, onCreated?: (tab: Tab) => void) => Promise<unknown>
  newTab(options?: { active?: boolean }, selectVisible?: boolean): Promise<unknown>
  closeTabTransition(tab: Tab): { splitPartnerId: string | null; nextId: string | undefined }
  removeTabRecord(tab: Tab): void
  markTabActiveInGroup(tab: Tab): void
}

const forgets = () => ({ forget: vi.fn() })

function fixture(spec: Array<{ id: string; workspace?: string | null; returnsTo?: string }>) {
  const group = (id: string) => ({ id, name: id, activeTabId: null, lastUsedAt: '2026-10-22T07:00:00.000Z' })
  return Object.assign(Object.create(BrowserTabsManager.prototype), {
    mcpTabGroups: new Map([['work', group('work')], ['other', group('other')]]),
    tabs: new Map(spec.map((tab, index) => [tab.id, {
      id: tab.id, url: `https://${tab.id}.example/`, pinned: false,
      ...(tab.workspace === null ? {} : { mcpGroupId: tab.workspace ?? 'work' }),
      ...(tab.returnsTo ? { returnsToTabId: tab.returnsTo } : {}),
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

describe('a new tab the person opens', () => {
  async function opened(shown: string, workspace: string, options?: { active?: boolean }, selectVisible?: boolean) {
    const manager = fixture([{ id: 'home', workspace: null }, { id: 'one' }, { id: 'elsewhere', workspace: 'other' }])
    manager.activeTabId = shown
    const created: Tab = { id: 'new', url: 'about:blank', pinned: false, mcpGroupId: workspace, webContents: { id: 9, isDestroyed: () => false } }
    manager.createNewTab = vi.fn(async (_options, _selectVisible, onCreated) => { onCreated?.(created) })
    await manager.newTab(options, selectVisible)
    return created
  }

  it('returns to the tab the person was on in its workspace', async () => {
    expect((await opened('one', 'work')).returnsToTabId).toBe('one')
    expect((await opened('one', 'work', { active: true })).returnsToTabId).toBe('one')
  })

  it('returns nowhere when it opens behind, for an agent, in another workspace or from Home', async () => {
    expect(await opened('one', 'work', { active: false })).not.toHaveProperty('returnsToTabId')
    expect(await opened('one', 'work', {}, false)).not.toHaveProperty('returnsToTabId')
    expect(await opened('elsewhere', 'work')).not.toHaveProperty('returnsToTabId')
    expect(await opened('home', 'work')).not.toHaveProperty('returnsToTabId')
  })
})

describe('closing a new tab', () => {
  it('shows the tab the person was on rather than the tab beside it', () => {
    const manager = fixture([{ id: 'one' }, { id: 'two' }, { id: 'three' }, { id: 'new', returnsTo: 'one' }])
    manager.activeTabId = 'new'
    expect(manager.closeTabTransition(manager.tabs.get('new')!).nextId).toBe('one')
  })

  it('shows the tab beside it once that tab is closed', () => {
    const manager = fixture([{ id: 'one' }, { id: 'two' }, { id: 'three' }, { id: 'new', returnsTo: 'one' }])
    manager.removeTabRecord(manager.tabs.get('one')!)
    manager.activeTabId = 'new'
    expect(manager.closeTabTransition(manager.tabs.get('new')!).nextId).toBe('three')
  })

  it('shows the tab beside it once another tab of its workspace showed, as in Chrome', () => {
    const manager = fixture([{ id: 'one' }, { id: 'two' }, { id: 'three' }, { id: 'new', returnsTo: 'one' }, { id: 'elsewhere', workspace: 'other' }])
    manager.mcpTabGroups.get('work')!.activeTabId = 'new'
    // Another workspace's tab is another window's in Chrome, which leaves this one as it was.
    manager.markTabActiveInGroup(manager.tabs.get('elsewhere')!)
    expect(manager.tabs.get('new')!.returnsToTabId).toBe('one')
    manager.markTabActiveInGroup(manager.tabs.get('new')!)
    expect(manager.tabs.get('new')!.returnsToTabId).toBe('one')
    manager.markTabActiveInGroup(manager.tabs.get('two')!)
    expect(manager.tabs.get('new')).not.toHaveProperty('returnsToTabId')
    manager.activeTabId = 'new'
    expect(manager.closeTabTransition(manager.tabs.get('new')!).nextId).toBe('three')
  })

  it('makes its workspace remember the tab the person was on when it closes off screen', () => {
    const manager = fixture([{ id: 'one' }, { id: 'two' }, { id: 'new', returnsTo: 'one' }, { id: 'elsewhere', workspace: 'other' }])
    manager.mcpTabGroups.get('work')!.activeTabId = 'new'
    manager.activeTabId = 'elsewhere'
    manager.removeTabRecord(manager.tabs.get('new')!)
    expect(manager.mcpTabGroups.get('work')!.activeTabId).toBe('one')
  })
})
