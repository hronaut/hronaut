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

// The prototype-built browsers below stub changed, getState and reorderTab; muting, reopening and duplicating tabs
// reach them through these.
vi.mock('../src/main/browser/browser-state/browser-state.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/main/browser/browser-state/browser-state.js')>(),
  publishChange: (browser: { changed: (persist?: boolean) => void }, persist?: boolean) => browser.changed(persist),
  browserState: (browser: { getState: () => unknown }) => browser.getState()
}))
// The browser's withTabLabelLifecycle stub runs the tab operations that wait for pending label saves.
vi.mock('../src/main/browser/tab-labels/tab-labels.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/main/browser/tab-labels/tab-labels.js')>(),
  withTabLabelLifecycle: (browser: { withTabLabelLifecycle: (run: () => Promise<unknown>) => Promise<unknown> }, run: () => Promise<unknown>) => (
    browser.withTabLabelLifecycle(run)
  )
}))
vi.mock('../src/main/browser/tab-arrangement/tab-arrangement.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/main/browser/tab-arrangement/tab-arrangement.js')>(),
  reorderTab: (
    browser: { reorderTab: (tabId: string, targetTabId: string, placement: 'before' | 'after') => unknown },
    tabId: string,
    targetTabId: string,
    placement: 'before' | 'after'
  ) => browser.reorderTab(tabId, targetTabId, placement)
}))
// Their closeWithBookkeeping stub does a real close's bookkeeping, which closing tabs for the person reaches through
// closeTab.
vi.mock('../src/main/browser/tab-close/close-tab.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/main/browser/tab-close/close-tab.js')>(),
  closeTab: (browser: { closeWithBookkeeping: (tabId: string) => Promise<unknown> }, tabId: string) => browser.closeWithBookkeeping(tabId)
}))

// The prototype-built browser below stubs roundPageCorners, with which a new tab's page gets the page card's corners.
vi.mock('../src/main/browser/window-layout/window-layout.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/main/browser/window-layout/window-layout.js')>(),
  roundPageCorners: (browser: { roundPageCorners: (...args: unknown[]) => unknown }, ...args: unknown[]) => browser.roundPageCorners(...args)
}))

// It also stubs the workspace's navigation check and observation generation, the session hooks and the page events,
// which createTab runs through these.
vi.mock('../src/main/browser/workspace-navigation/workspace-navigation.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/main/browser/workspace-navigation/workspace-navigation.js')>(),
  assertWorkspaceNavigationAllowed: (browser: { assertWorkspaceNavigationAllowed: (...args: unknown[]) => unknown }, ...args: unknown[]) => browser.assertWorkspaceNavigationAllowed(...args)
}))
vi.mock('../src/main/browser/workspace-continuity/workspace-continuity.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/main/browser/workspace-continuity/workspace-continuity.js')>(),
  workspaceObservationGeneration: (browser: { workspaceObservationGeneration: (...args: unknown[]) => unknown }, ...args: unknown[]) => browser.workspaceObservationGeneration(...args)
}))
vi.mock('../src/main/browser/session-hooks/session-hooks.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/main/browser/session-hooks/session-hooks.js')>(),
  installSessionHooks: (browser: { installSessionHooks: (...args: unknown[]) => unknown }, ...args: unknown[]) => browser.installSessionHooks(...args)
}))
vi.mock('../src/main/browser/tab-events/attach-tab-events.js', () => ({
  attachTabEvents: (browser: { attachTabEvents: (...args: unknown[]) => unknown }, ...args: unknown[]) => browser.attachTabEvents(...args)
}))
const { Browser } = await import('../src/main/browser/browser.js')
const { WorkspaceRegistry } = await import('../src/main/browser/workspace-registry/workspace-registry.js')
const { closeTabsForPerson } = await import('../src/main/browser/tab-close/close-tabs-for-person.js')
const { duplicateTabAfterLabelSave, rememberClosedTab, reopenClosedTabEntry } = await import('../src/main/browser/tab-reopening/tab-reopening.js')
const { setAllTabsMuted, setTabMuted } = await import('../src/main/browser/tab-muting/tab-muting.js')

const WORKSPACE = '01912345-6789-7abc-8def-0123456789ab'

interface Tab { id: string; url: string; muted: boolean; tabMuted: boolean; mcpGroupId?: string; webContents: { audioMuted: boolean } }
interface Manager {
  tabs: Map<string, Tab>
  createTab(options: { url: string; mcpGroupId: string; active: boolean }): Promise<Tab>
  closeWithBookkeeping(tabId: string): Promise<unknown>
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
    async closeWithBookkeeping(this: Manager, tabId: string) {
      // The close bookkeeping of a real close: the tab is remembered, then removed.
      rememberClosedTab(this as never, this.tabs.get(tabId)! as never)
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
  setTabMuted(manager as never, tab.id, true)
  expect(tab).toMatchObject({ muted: true, tabMuted: true, webContents: { audioMuted: true } })
  return tab
}

const sound = (tab: Tab | undefined) => ({ muted: tab?.muted, tabMuted: tab?.tabMuted, pageMuted: tab?.webContents.audioMuted })
const MUTED = { muted: true, tabMuted: true, pageMuted: true }
const findByUrl = (manager: Manager, url: string) => [...manager.tabs.values()].find((candidate) => candidate.url === url)

/** Reopens the most recently closed tab in the background, as Reopen Closed Tab does before showing it. */
const reopenLastClosed = async (manager: Manager): Promise<Tab> => await reopenClosedTabEntry(manager as never, undefined, false) as unknown as Tab

describe('a muted tab brought back', () => {
  it('stays muted after Reopen Closed Tab', async () => {
    const { manager } = browser()
    const tab = await mutedTab(manager)
    await manager.closeWithBookkeeping(tab.id)

    expect(sound(await reopenLastClosed(manager))).toEqual(MUTED)
  })

  it('stays muted after Undo of closing it', async () => {
    const { manager, offers } = browser()
    const tab = await mutedTab(manager)
    await closeTabsForPerson(manager as never, [tab.id])

    await offers[0]!.undo()

    expect(sound(findByUrl(manager, tab.url))).toEqual(MUTED)
  })

  it('stays muted in its duplicate', async () => {
    const { manager } = browser()
    const tab = await mutedTab(manager)

    await duplicateTabAfterLabelSave(manager as never, tab.id)

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
    setAllTabsMuted(manager as never, true)
    expect(sound(tab)).toEqual({ muted: true, tabMuted: false, pageMuted: true })
    return tab
  }
  const SOUND = { muted: false, tabMuted: false, pageMuted: false }

  it('comes back with sound after Reopen Closed Tab', async () => {
    const { manager } = browser()
    const tab = await quietTab(manager)
    await manager.closeWithBookkeeping(tab.id)
    setAllTabsMuted(manager as never, false)

    expect(sound(await reopenLastClosed(manager))).toEqual(SOUND)
  })

  it('has a duplicate with sound', async () => {
    const { manager } = browser()
    const tab = await quietTab(manager)
    await duplicateTabAfterLabelSave(manager as never, tab.id)
    setAllTabsMuted(manager as never, false)

    expect(sound([...manager.tabs.values()].find((candidate) => candidate.id !== tab.id))).toEqual(SOUND)
  })

  it('comes back with sound when its workspace is archived and restored', async () => {
    const { manager, registry } = browser()
    const tab = await quietTab(manager)
    await registry.archive(WORKSPACE)
    expect(registry.archived.get(WORKSPACE)?.tabs[0]).not.toHaveProperty('muted')
    setAllTabsMuted(manager as never, false)

    await registry.restore(WORKSPACE)

    expect(sound(findByUrl(manager, tab.url))).toEqual(SOUND)
  })
})
