import { afterEach, describe, expect, it, vi } from 'vitest'
vi.mock('electron', () => ({ session: {}, WebContentsView: class {}, nativeImage: {}, shell: {}, app: { getPath: () => '/tmp' }, Menu: {} }))
import type { MenuItemConstructorOptions } from 'electron'
import { BrowserTabsManager } from '../src/main/browser/tabs-manager.js'

afterEach(() => {
  vi.useRealTimers()
})

interface Group { id: string; name: string; pinnedAt?: string; lastUsedAt: string }
interface Tab { id: string; url: string; pinned: boolean; mcpGroupId?: string; webContents: { isDestroyed: () => boolean } }

interface Internals {
  mcpTabGroups: Map<string, Group>
  tabs: Map<string, Tab>
  activeTabId: string | null
  changed: ReturnType<typeof vi.fn>
  window: { webContents: { send: ReturnType<typeof vi.fn> } }
  orderedTabs(): Tab[]
  closeTabTransition(tab: Tab): { splitPartnerId: string | null; nextId: string | undefined }
  workspaceContextMenuItems(group: Group): MenuItemConstructorOptions[]
}

function fixture(groups: Group[], tabs: Omit<Tab, 'webContents'>[] = []) {
  const manager = Object.assign(Object.create(BrowserTabsManager.prototype), {
    mcpTabGroups: new Map(groups.map((group) => [group.id, group])),
    tabs: new Map(tabs.map((tab) => [tab.id, { ...tab, webContents: { isDestroyed: () => false } }])),
    activeTabId: tabs[0]?.id ?? null,
    splitView: null,
    allHumanInteractionLocked: false,
    options: { getLocale: () => 'en-US' },
    window: { webContents: { send: vi.fn() } },
    changed: vi.fn(),
    getState: vi.fn(() => ({ tabs: [] }))
  }) as BrowserTabsManager
  return { manager, internals: manager as unknown as Internals }
}

const group = (id: string, pinnedAt?: string): Group => ({ id, name: id, lastUsedAt: '2026-10-17T09:00:00.000Z', ...(pinnedAt ? { pinnedAt } : {}) })

describe('pinning a workspace in main', () => {
  it('stores the pin time and clears it on unpin, leaving its last use alone', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(Date.UTC(2026, 9, 17, 12))
    const { manager, internals } = fixture([group('alpha'), group('beta')])
    manager.setWorkspacePinned('beta', true)
    const beta = internals.mcpTabGroups.get('beta')!
    expect(beta.pinnedAt).toBe('2026-10-17T12:00:00.000Z')
    expect(beta.lastUsedAt).toBe('2026-10-17T09:00:00.000Z')
    expect(internals.changed).toHaveBeenCalledOnce()
    manager.setWorkspacePinned('beta', false)
    expect(beta.pinnedAt).toBeUndefined()
    expect(internals.changed).toHaveBeenCalledTimes(2)
  })

  it('keeps an existing pin time and makes no change when the pin already matches', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(Date.UTC(2026, 9, 17, 12))
    const { manager, internals } = fixture([group('alpha', '2026-10-01T00:00:00.000Z'), group('beta')])
    manager.setWorkspacePinned('alpha', true)
    manager.setWorkspacePinned('beta', false)
    expect(internals.mcpTabGroups.get('alpha')!.pinnedAt).toBe('2026-10-01T00:00:00.000Z')
    expect(internals.mcpTabGroups.get('beta')!.pinnedAt).toBeUndefined()
    expect(internals.changed).not.toHaveBeenCalled()
  })

  it('places a new pin after every earlier one even when the clock went back', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const { manager, internals } = fixture([group('alpha'), group('beta'), group('gamma')])
    vi.setSystemTime(Date.UTC(2026, 9, 17, 12))
    manager.setWorkspacePinned('alpha', true)
    // The system clock is set back an hour before the next pin.
    vi.setSystemTime(Date.UTC(2026, 9, 17, 11))
    manager.setWorkspacePinned('beta', true)
    manager.setWorkspacePinned('gamma', true)
    const times = ['alpha', 'beta', 'gamma'].map((id) => Date.parse(internals.mcpTabGroups.get(id)!.pinnedAt!))
    expect(times[1]).toBeGreaterThan(times[0]!)
    expect(times[2]).toBeGreaterThan(times[1]!)
  })

  it('ignores an unreadable saved pin time when placing a new pin', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(Date.UTC(2026, 9, 17, 12))
    const { manager, internals } = fixture([group('broken', 'not a time'), group('beta')])
    manager.setWorkspacePinned('beta', true)
    expect(internals.mcpTabGroups.get('beta')!.pinnedAt).toBe('2026-10-17T12:00:00.000Z')
  })

  it('refuses an unknown workspace', () => {
    const { manager } = fixture([group('alpha')])
    expect(() => manager.setWorkspacePinned('missing', true)).toThrow('Unknown workspace: missing')
  })
})

describe('tab order in main with pinned workspaces', () => {
  const tabs = [
    { id: 'alpha-1', url: 'https://alpha.test/1', pinned: false, mcpGroupId: 'alpha' },
    { id: 'beta-1', url: 'https://beta.test/1', pinned: false, mcpGroupId: 'beta' },
    { id: 'gamma-1', url: 'https://gamma.test/1', pinned: false, mcpGroupId: 'gamma' },
    { id: 'alpha-2', url: 'https://alpha.test/2', pinned: false, mcpGroupId: 'alpha' },
    { id: 'gamma-pinned', url: 'https://gamma.test/pinned', pinned: true, mcpGroupId: 'gamma' },
    { id: 'home', url: 'hronaut://home/', pinned: false }
  ]

  it('orders Home, then workspaces with pinned ones first, the earliest pinned first, each with its pinned tabs first', () => {
    const { internals } = fixture([
      group('alpha'),
      group('beta', '2026-10-17T12:00:00.000Z'),
      group('gamma', '2026-10-17T11:00:00.000Z')
    ], tabs)
    expect(internals.orderedTabs().map((tab) => tab.id)).toEqual(['home', 'gamma-pinned', 'gamma-1', 'beta-1', 'alpha-1', 'alpha-2'])
  })

  it('returns an unpinned workspace to its stored place', () => {
    const { manager, internals } = fixture([group('alpha'), group('beta'), group('gamma')], tabs)
    const stored = internals.orderedTabs().map((tab) => tab.id)
    expect(stored).toEqual(['home', 'alpha-1', 'alpha-2', 'beta-1', 'gamma-pinned', 'gamma-1'])
    manager.setWorkspacePinned('beta', true)
    expect(internals.orderedTabs().map((tab) => tab.id)).toEqual(['home', 'beta-1', 'alpha-1', 'alpha-2', 'gamma-pinned', 'gamma-1'])
    manager.setWorkspacePinned('beta', false)
    expect(internals.orderedTabs().map((tab) => tab.id)).toEqual(stored)
  })

  it('shows the next tab on screen after closing the last tab of a pinned workspace', () => {
    const { internals } = fixture([group('alpha'), group('beta', '2026-10-17T12:00:00.000Z')], [
      { id: 'alpha-1', url: 'https://alpha.test/1', pinned: false, mcpGroupId: 'alpha' },
      { id: 'beta-1', url: 'https://beta.test/1', pinned: false, mcpGroupId: 'beta' }
    ])
    internals.activeTabId = 'beta-1'
    // On screen beta comes first, so alpha follows it, rather than wrapping back as the stored order would.
    expect(internals.closeTabTransition(internals.tabs.get('beta-1')!).nextId).toBe('alpha-1')
    internals.activeTabId = 'alpha-1'
    expect(internals.closeTabTransition(internals.tabs.get('alpha-1')!).nextId).toBe('beta-1')
  })

  // A pinned tab of any workspace but the first came before every other workspace's tabs, so closing it showed the
  // first workspace's tab, and Ctrl+1 to 9 and Ctrl+Tab went by that order rather than the one on screen.
  it('keeps a later workspace\'s pinned tab in its workspace, and shows that workspace\'s next tab when it closes', () => {
    const { internals } = fixture([group('work'), group('docs')], [
      { id: 'work-1', url: 'https://work.test/1', pinned: false, mcpGroupId: 'work' },
      { id: 'work-2', url: 'https://work.test/2', pinned: false, mcpGroupId: 'work' },
      { id: 'docs-2', url: 'https://docs.test/2', pinned: false, mcpGroupId: 'docs' },
      { id: 'docs-pinned', url: 'https://docs.test/pinned', pinned: true, mcpGroupId: 'docs' }
    ])
    expect(internals.orderedTabs().map((tab) => tab.id)).toEqual(['work-1', 'work-2', 'docs-pinned', 'docs-2'])
    internals.activeTabId = 'docs-pinned'
    expect(internals.closeTabTransition(internals.tabs.get('docs-pinned')!).nextId).toBe('docs-2')
  })
})

describe('the workspace menu\'s pin item', () => {
  const pinItem = (items: MenuItemConstructorOptions[]) => items.find((item) => item.id === 'pin-workspace')!
  const click = (item: MenuItemConstructorOptions) => (item.click as () => void)()

  it('reads Pin for an unpinned workspace and Unpin for a pinned one', () => {
    const { internals } = fixture([group('alpha'), group('beta', '2026-10-17T12:00:00.000Z')])
    expect(pinItem(internals.workspaceContextMenuItems(internals.mcpTabGroups.get('alpha')!)).label).toBe('Pin Workspace to Top')
    expect(pinItem(internals.workspaceContextMenuItems(internals.mcpTabGroups.get('beta')!)).label).toBe('Unpin Workspace')
  })

  it('does what its label said when the menu opened, even if the pin changed meanwhile', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(Date.UTC(2026, 9, 17, 12))
    const { manager, internals } = fixture([group('alpha')])
    const alpha = internals.mcpTabGroups.get('alpha')!
    const pin = pinItem(internals.workspaceContextMenuItems(alpha))
    // Another menu pinned it before this one's click.
    manager.setWorkspacePinned('alpha', true)
    const pinnedAt = alpha.pinnedAt
    click(pin)
    expect(alpha.pinnedAt).toBe(pinnedAt)

    const unpin = pinItem(internals.workspaceContextMenuItems(alpha))
    manager.setWorkspacePinned('alpha', false)
    click(unpin)
    expect(alpha.pinnedAt).toBeUndefined()
  })

  // New Tab in Workspace opened the tab itself, so the cursor stayed out of the address field; the window now opens it
  // as its + button does.
  it('asks the window for a new tab in the workspace with New Tab in Workspace', () => {
    const { internals } = fixture([group('alpha')])
    const item = internals.workspaceContextMenuItems(internals.mcpTabGroups.get('alpha')!).find((candidate) => candidate.id === 'new-tab-in-workspace')!
    click(item)
    expect(internals.window.webContents.send).toHaveBeenCalledExactlyOnceWith('browser:new-tab-requested', 'alpha')
  })

  it('pins with a click on Pin and unpins with a click on Unpin', () => {
    const { internals } = fixture([group('alpha')])
    const alpha = internals.mcpTabGroups.get('alpha')!
    click(pinItem(internals.workspaceContextMenuItems(alpha)))
    expect(alpha.pinnedAt).toEqual(expect.any(String))
    click(pinItem(internals.workspaceContextMenuItems(alpha)))
    expect(alpha.pinnedAt).toBeUndefined()
  })
})
