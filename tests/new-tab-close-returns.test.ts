import { describe, expect, it, vi } from 'vitest'
vi.mock('electron', () => ({ session: {}, WebContentsView: class {}, nativeImage: {}, shell: {}, app: { getPath: () => '/tmp' }, Menu: {} }))
// The prototype-built browser below stubs createNewTab, which opening a new tab goes through.
vi.mock('../src/main/browser/new-tabs/new-tabs.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/main/browser/new-tabs/new-tabs.js')>(),
  createNewTab: (browser: { createNewTab: (...args: unknown[]) => unknown }, ...args: unknown[]) => browser.createNewTab(...args)
}))
// The prototype-built browser below stubs invalidateTabOverviewPreview, which closing a tab drops its overview preview with.
vi.mock('../src/main/browser/tab-overview-previews/tab-overview-previews.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/main/browser/tab-overview-previews/tab-overview-previews.js')>(),
  invalidateTabOverviewPreview: (browser: { invalidateTabOverviewPreview: (...args: unknown[]) => unknown }, ...args: unknown[]) => browser.invalidateTabOverviewPreview(...args)
}))
import { Browser } from '../src/main/browser/browser.js'

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
  newTab(options?: { active?: boolean; url?: string }, selectVisible?: boolean): Promise<unknown>
  closeTabTransition(tab: Tab): { splitPartnerId: string | null; nextId: string | undefined }
  removeTabRecord(tab: Tab): void
  markTabActiveInGroup(tab: Tab): void
  writeActiveTabId(tabId: string | null): void
}

const forgets = () => ({ forget: vi.fn() })

function fixture(spec: Array<{ id: string; workspace?: string | null; returnsTo?: string }>) {
  const group = (id: string) => ({ id, name: id, activeTabId: null, lastUsedAt: '2026-10-22T07:00:00.000Z' })
  return Object.assign(Object.create(Browser.prototype), {
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
  async function opened(shown: string, workspace: string, options?: { active?: boolean; url?: string }, selectVisible?: boolean) {
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

  it('returns nowhere when it opens at an address, behind, for an agent, in another workspace or from Home', async () => {
    // A bookmark or a help link opened in a new tab closes as any tab, as in Chrome.
    expect(await opened('one', 'work', { url: 'https://docs.example/' })).not.toHaveProperty('returnsToTabId')
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

  it('shows the tab beside it once another tab showed, as in Chrome', () => {
    const manager = fixture([{ id: 'one' }, { id: 'two' }, { id: 'three' }, { id: 'new', returnsTo: 'one' }])
    manager.activeTabId = 'new'
    manager.mcpTabGroups.get('work')!.activeTabId = 'new'
    // An agent's tab becomes its workspace's tab without showing, which leaves the shown new tab as it was.
    manager.markTabActiveInGroup(manager.tabs.get('two')!)
    manager.writeActiveTabId('new')
    expect(manager.tabs.get('new')!.returnsToTabId).toBe('one')
    manager.writeActiveTabId('two')
    expect(manager.tabs.get('new')).not.toHaveProperty('returnsToTabId')
    manager.writeActiveTabId('new')
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
