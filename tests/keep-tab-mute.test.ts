import { describe, expect, it, vi } from 'vitest'
import type { UndoableAction } from '../src/main/undo-offers.js'

// A tab's own mute survived a restart, but a tab brought back another way came back with sound: Reopen Closed Tab,
// Undo of closing it, Duplicate, and restoring its archived workspace, which Undo of closing or archiving one does.

vi.mock('electron', () => {
  let nextWebContentsId = 100
  class WebContentsView {
    webContents = {
      id: nextWebContentsId++,
      session: { partition: 'workspace' },
      audioMuted: false,
      isDestroyed: () => false,
      setAudioMuted(muted: boolean) { this.audioMuted = muted },
      isAudioMuted() { return this.audioMuted },
      isLoading: () => false,
      getURL: () => '',
      loadURL: () => Promise.resolve(),
      navigationHistory: { restore: () => Promise.resolve() }
    }
    setBackgroundColor(): void {}
    setBounds(): void {}
  }
  return { session: {}, WebContentsView, nativeImage: {}, shell: {}, app: { getPath: () => '/tmp' }, powerMonitor: { on: () => undefined }, Menu: {} }
})

const { Browser } = await import('../src/main/browser/browser.js')
const { WorkspaceRegistry } = await import('../src/main/browser/workspace-registry.js')
const { closeTabsForPerson } = await import('../src/main/browser/tab-close/close-tabs-for-person.js')

const WORKSPACE = '01912345-6789-7abc-8def-0123456789ab'

interface Tab { id: string; url: string; muted: boolean; tabMuted: boolean; mcpGroupId?: string; webContents: { audioMuted: boolean } }
interface Manager {
  tabs: Map<string, Tab>
  createTab(options: { url: string; mcpGroupId: string; active: boolean }): Promise<Tab>
  setTabMuted(tabId: string, muted: boolean): unknown
  setAllTabsMuted(muted: boolean): unknown
  rememberClosedTab(tab: Tab): void
  reopenClosedTabEntry(closedTabId: string | undefined, active: boolean): Promise<Tab>
  duplicateTabAfterLabelSave(tabId: string): Promise<unknown>
  personTabCloseAccess(): never
  closeTabInternal(tabId: string): Promise<unknown>
}

/**
 * Tabs made by the real tab manager's createTab, with Electron's views faked so a page's mute is recorded, in one
 * workspace of a real workspace registry wired to the same manager.
 */
function browser() {
  const offers: UndoableAction[] = []
  const manager = Object.assign(Object.create(Browser.prototype), {
    destroyed: false, initialized: true, restoringLayout: false,
    options: { partition: 'persist:hronaut', offerUndo: (offer: UndoableAction) => { offers.push(offer) } },
    window: {
      isDestroyed: () => false, isFocused: () => true, getContentBounds: () => ({ x: 0, y: 0, width: 1440, height: 900 }),
      webContents: { isDestroyed: () => false, getZoomFactor: () => 1 },
      contentView: { children: [], addChildView: vi.fn(), removeChildView: vi.fn() }
    },
    tabs: new Map(), closedTabs: [], detachedClosedTabs: new Set(), workspaceOperations: new Map(), webContentsToTab: new Map(),
    openedTabObservations: new Map(), activeTabId: 'existing', splitView: null, tabSelectionGeneration: 0, toolbarHeight: 60,
    contentInsets: { top: 0, right: 10, bottom: 10, left: 280 }, allTabsMuted: false,
    assertWorkspaceNavigationAllowed: vi.fn(), workspaceNavigationAllowed: () => true, workspaceObservationGeneration: () => 0,
    roundPageCorners: vi.fn(), installSessionHooks: vi.fn(), attachTabEvents: vi.fn(), layout: vi.fn(), changed: vi.fn(),
    selectTab: vi.fn(), reorderTab: vi.fn(), navigationHistorySnapshot: () => ({ entries: [], index: -1 }),
    withTabLabelLifecycle: (run: () => Promise<unknown>) => run(), getState: () => ({}), text: (key: string) => key,
    orderedTabs(this: Manager) { return [...this.tabs.values()] },
    async closeTabInternal(this: Manager, tabId: string) {
      // The close bookkeeping of a real close: the tab is remembered, then removed.
      this.rememberClosedTab(this.tabs.get(tabId)!)
      this.tabs.delete(tabId)
      return {}
    }
  }) as Manager
  const registry: InstanceType<typeof WorkspaceRegistry> = new WorkspaceRegistry({
    maxTabs: 50,
    maxArchived: 50,
    tabs: () => [...manager.tabs.values()] as never,
    requireActive: (id) => ({ id }) as never,
    assertRestoreCapacity: () => undefined,
    withActiveOperation: (_id, _action, run) => run(),
    withArchivedOperation: (_id, _action, run) => run(),
    closeActive: async (id) => {
      for (const tab of [...manager.tabs.values()]) if (tab.mcpGroupId === id) manager.tabs.delete(tab.id)
      registry.active.delete(id)
    },
    createTab: (tab) => manager.createTab(tab as never),
    selectTab: () => undefined,
    remapDownloads: () => undefined,
    changed: () => undefined
  })
  registry.active.set(WORKSPACE, {
    id: WORKSPACE, name: 'Client', description: '', color: 'blue', createdAt: '', lastUsedAt: '', activeTabId: null,
    storageId: '8e3da8ea-cba4-41c2-9619-a6e04a493a44', origins: [], navigationPolicy: { mode: 'unrestricted', rules: [] },
    navigationAudit: [], contextClass: 'standard'
  })
  Object.assign(manager, { mcpTabGroups: registry.active, savedTabGroups: registry.archived })
  return { manager, registry, offers }
}

async function mutedTab(manager: Manager): Promise<Tab> {
  const tab = await manager.createTab({ url: 'https://video.example/autoplay', mcpGroupId: WORKSPACE, active: false })
  manager.setTabMuted(tab.id, true)
  expect(tab).toMatchObject({ muted: true, tabMuted: true, webContents: { audioMuted: true } })
  return tab
}

const sound = (tab: Tab | undefined) => ({ muted: tab?.muted, tabMuted: tab?.tabMuted, pageMuted: tab?.webContents.audioMuted })
const MUTED = { muted: true, tabMuted: true, pageMuted: true }
const findByUrl = (manager: Manager, url: string) => [...manager.tabs.values()].find((candidate) => candidate.url === url)

describe('a muted tab brought back', () => {
  it('stays muted after Reopen Closed Tab', async () => {
    const { manager } = browser()
    const tab = await mutedTab(manager)
    await manager.closeTabInternal(tab.id)

    expect(sound(await manager.reopenClosedTabEntry(undefined, false))).toEqual(MUTED)
  })

  it('stays muted after Undo of closing it', async () => {
    const { manager, offers } = browser()
    const tab = await mutedTab(manager)
    await closeTabsForPerson(manager.personTabCloseAccess(), [tab.id])

    await offers[0]!.undo()

    expect(sound(findByUrl(manager, tab.url))).toEqual(MUTED)
  })

  it('stays muted in its duplicate', async () => {
    const { manager } = browser()
    const tab = await mutedTab(manager)

    await manager.duplicateTabAfterLabelSave(tab.id)

    expect(sound([...manager.tabs.values()].find((candidate) => candidate.id !== tab.id))).toEqual(MUTED)
  })

  it('stays muted when its workspace is archived and restored', async () => {
    const { manager, registry } = browser()
    const tab = await mutedTab(manager)
    await registry.archive(WORKSPACE)
    expect(manager.tabs.size).toBe(0)

    await registry.restore(WORKSPACE)

    expect(sound(findByUrl(manager, tab.url))).toEqual(MUTED)
  })
})

describe('a tab muted only because every tab was muted', () => {
  // Muting every tab from the menu mutes each page too, but not the tab's own mute: once every tab is unmuted again,
  // the tab brought back must have sound.
  async function quietTab(manager: Manager): Promise<Tab> {
    const tab = await manager.createTab({ url: 'https://docs.example/', mcpGroupId: WORKSPACE, active: false })
    manager.setAllTabsMuted(true)
    expect(sound(tab)).toEqual({ muted: true, tabMuted: false, pageMuted: true })
    return tab
  }
  const SOUND = { muted: false, tabMuted: false, pageMuted: false }

  it('comes back with sound after Reopen Closed Tab', async () => {
    const { manager } = browser()
    const tab = await quietTab(manager)
    await manager.closeTabInternal(tab.id)
    manager.setAllTabsMuted(false)

    expect(sound(await manager.reopenClosedTabEntry(undefined, false))).toEqual(SOUND)
  })

  it('has a duplicate with sound', async () => {
    const { manager } = browser()
    const tab = await quietTab(manager)
    await manager.duplicateTabAfterLabelSave(tab.id)
    manager.setAllTabsMuted(false)

    expect(sound([...manager.tabs.values()].find((candidate) => candidate.id !== tab.id))).toEqual(SOUND)
  })

  it('comes back with sound when its workspace is archived and restored', async () => {
    const { manager, registry } = browser()
    const tab = await quietTab(manager)
    await registry.archive(WORKSPACE)
    expect(registry.archived.get(WORKSPACE)?.tabs[0]).not.toHaveProperty('muted')
    manager.setAllTabsMuted(false)

    await registry.restore(WORKSPACE)

    expect(sound(findByUrl(manager, tab.url))).toEqual(SOUND)
  })
})
