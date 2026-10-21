import { describe, expect, it, vi } from 'vitest'
vi.mock('electron', () => ({ session: {}, WebContentsView: class {}, nativeImage: {}, shell: {}, app: { getPath: () => '/tmp' }, Menu: {} }))
import { BrowserTabsManager } from '../src/main/browser/tabs-manager.js'

// When the tab a workspace remembered closed while another workspace was on screen, for example when an agent closed
// it, the workspace remembered its first tab. Going back to the workspace showed that tab, and agent commands without
// a tab ID used it, where closing the same tab on screen shows, and remembers, the popup's opener or the tab beside it.

interface Tab {
  id: string; url: string; pinned: boolean; mcpGroupId: string; openerTabId?: string
  webContents: { id: number; isDestroyed: () => boolean }
}
interface Internals {
  tabs: Map<string, Tab>
  mcpTabGroups: Map<string, { id: string; activeTabId: string | null; lastUsedAt: string }>
  removeTabRecord(tab: Tab): void
}

const forgets = () => ({ forget: vi.fn() })

function fixture(tabs: Array<{ id: string; pinned?: boolean; destroyed?: boolean; openerTabId?: string }>, remembered: string) {
  return Object.assign(Object.create(BrowserTabsManager.prototype), {
    mcpTabGroups: new Map([['work', { id: 'work', name: 'work', activeTabId: remembered, lastUsedAt: '2026-10-21T09:00:00.000Z' }]]),
    tabs: new Map(tabs.map((tab, index) => [tab.id, {
      id: tab.id, url: `https://${tab.id}.example/`, pinned: tab.pinned === true, mcpGroupId: 'work',
      ...(tab.openerTabId ? { openerTabId: tab.openerTabId } : {}),
      webContents: { id: index + 1, isDestroyed: () => tab.destroyed === true }
    }])),
    cssStatePreview: forgets(), virtualPasskeys: forgets(), domMutationSource: forgets(), logpoints: forgets(), workerEvaluations: forgets(),
    invalidateTabOverviewPreview: vi.fn(), tabOverviewSleepPreviews: new Map(), tabOverviewPreviewCaptures: { cancelPending: vi.fn() },
    tabOverviewPreviewableTabs: new Set(), runWalletLifecycleAction: vi.fn(), options: {}, deleteSnapshotBaselineForTab: vi.fn(),
    globallyUnlockedTabIds: new Set(), globallyResumedAgentTabIds: new Set(), browserSessionAuthorityHooks: new Map(),
    mcpActivitiesByTab: new Map(), mcpActivityFollower: { removeTab: vi.fn() }, webContentsToTab: new Map()
  }) as unknown as Internals
}

function close(manager: Internals, id: string): string | null {
  manager.removeTabRecord(manager.tabs.get(id)!)
  return manager.mcpTabGroups.get('work')!.activeTabId
}

describe('a workspace whose remembered tab closes', () => {
  it('remembers the tab to its right', () => {
    const manager = fixture([{ id: 'one' }, { id: 'two' }, { id: 'three' }], 'two')
    expect(close(manager, 'two')).toBe('three')
  })

  it('remembers the tab to its left when it was the last tab', () => {
    const manager = fixture([{ id: 'one' }, { id: 'two' }, { id: 'three' }], 'three')
    expect(close(manager, 'three')).toBe('two')
  })

  it('goes by the order on screen, where pinned tabs come first', () => {
    // On screen the pinned tabs come first, so the first pinned tab is followed by the second.
    const manager = fixture([{ id: 'one' }, { id: 'pinned-1', pinned: true }, { id: 'two' }, { id: 'pinned-2', pinned: true }], 'pinned-1')
    expect(close(manager, 'pinned-1')).toBe('pinned-2')
  })

  it('skips a tab whose page is already gone', () => {
    const manager = fixture([{ id: 'one' }, { id: 'two' }, { id: 'gone', destroyed: true }, { id: 'three' }], 'two')
    expect(close(manager, 'two')).toBe('three')
  })

  it('remembers the tab beside a remembered tab whose page is already gone', () => {
    const manager = fixture([{ id: 'one' }, { id: 'gone', destroyed: true }, { id: 'three' }], 'gone')
    expect(close(manager, 'gone')).toBe('three')
  })

  it('remembers the tab that opened a popup when the popup closes, as on screen', () => {
    // A sign-in popup opens at the end of its workspace and closes itself, often while another workspace is shown.
    const manager = fixture([{ id: 'app' }, { id: 'docs' }, { id: 'popup', openerTabId: 'app' }], 'popup')
    expect(close(manager, 'popup')).toBe('app')
  })

  it('remembers the tab beside a popup whose opener closed', () => {
    const manager = fixture([{ id: 'app' }, { id: 'docs' }, { id: 'popup', openerTabId: 'closed' }], 'popup')
    expect(close(manager, 'popup')).toBe('docs')
  })

  it('remembers no tab when it was the only one, and keeps another remembered tab', () => {
    const only = fixture([{ id: 'one' }], 'one')
    expect(close(only, 'one')).toBeNull()
    const other = fixture([{ id: 'one' }, { id: 'two' }, { id: 'three' }], 'one')
    expect(close(other, 'two')).toBe('one')
  })
})
