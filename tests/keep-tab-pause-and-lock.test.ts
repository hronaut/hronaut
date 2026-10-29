import { describe, expect, it, vi } from 'vitest'
import type { UndoableAction } from '../src/main/undo-offers.js'

// A tab whose agents you paused, or whose input you locked, kept that after a restart but lost it when it was brought
// back another way: Reopen Closed Tab, Undo of closing it, and restoring its archived workspace, which Undo of closing
// or archiving one does. Its agents could then act in the tab again. A duplicate of it was not paused or locked either.

vi.mock('electron', () => {
  let nextWebContentsId = 100
  class WebContentsView {
    webContents = {
      id: nextWebContentsId++,
      session: { partition: 'workspace' },
      isDestroyed: () => false,
      isDevToolsOpened: () => false,
      setAudioMuted() {},
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
// The prototype-built browsers below stub changed, getState and reorderTab; the pause functions publish through
// these, and reopening and duplicating tabs move them through reorderTab.
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

const { Browser } = await import('../src/main/browser/browser.js')
const { WorkspaceRegistry } = await import('../src/main/browser/workspace-registry.js')
const { closeTabsForPerson } = await import('../src/main/browser/tab-close/close-tabs-for-person.js')

const WORKSPACE = '01912345-6789-7abc-8def-0123456789ab'

interface Tab { id: string; url: string; tabAgentPaused: boolean; humanInteractionLocked: boolean; mcpGroupId?: string }
interface Manager {
  tabs: Map<string, Tab>
  createTab(options: { url: string; mcpGroupId: string; active: boolean }): Promise<Tab>
  setTabAgentPaused(tabId: string, paused: boolean): unknown
  setAllAgentsPaused(paused: boolean): void
  setTabHumanInteractionLocked(tabId: string, locked: boolean): Promise<unknown>
  setAllHumanInteractionLocked(locked: boolean): Promise<unknown>
  isTabAgentPaused(tabId: string): boolean
  isHumanInteractionLocked(tab: Tab): boolean
  rememberClosedTab(tab: Tab): void
  reopenClosedTabEntry(closedTabId: string | undefined, active: boolean): Promise<Tab>
  duplicateTabAfterLabelSave(tabId: string): Promise<unknown>
  personTabCloseAccess(): never
  closeTabInternal(tabId: string): Promise<unknown>
}

/**
 * Tabs made by the real tab manager's createTab, paused and locked by its own controls, with Electron's views and the
 * page's native input guard faked, in one workspace of a real workspace registry wired to the same manager.
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
    allAgentsPaused: false, agentPauseOverridesAllowed: true, globallyResumedAgentTabIds: new Set(),
    liveRegionRecorder: { release: vi.fn() }, cssStatePreview: { clear: () => Promise.resolve() },
    virtualPasskeys: { stop: vi.fn() }, logpoints: { stop: vi.fn() },
    allHumanInteractionLocked: false, globallyUnlockedTabIds: new Set(), interactionLockTail: Promise.resolve(),
    nativeInputLockMutations: 0, debuggerQueue: { pending: () => undefined }, dialogMonitorAttachPromises: new Map(),
    screenshotAreaSessions: new Map(), elementPickerSessions: new Map(), withDebugger: () => Promise.resolve(),
    assertWorkspaceNavigationAllowed: vi.fn(), workspaceNavigationAllowed: () => true, workspaceObservationGeneration: () => 0,
    roundPageCorners: vi.fn(), installSessionHooks: vi.fn(), attachTabEvents: vi.fn(), layout: vi.fn(), changed: vi.fn(),
    selectTab: vi.fn(), reorderTab: vi.fn(), navigationHistorySnapshot: () => ({ entries: [], index: -1 }),
    withTabLabelLifecycle: (run: () => Promise<unknown>) => run(), getState: () => ({}), text: (key: string) => key,
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

/** A tab whose agents the person paused and whose input they locked, from the tab's own controls. */
async function guardedTab(manager: Manager): Promise<Tab> {
  const tab = await manager.createTab({ url: 'https://bank.example/account', mcpGroupId: WORKSPACE, active: false })
  manager.setTabAgentPaused(tab.id, true)
  await manager.setTabHumanInteractionLocked(tab.id, true)
  expect(guards(manager, tab)).toEqual(GUARDED)
  return tab
}

const guards = (manager: Manager, tab: Tab | undefined) => tab && ({
  agentsPaused: manager.isTabAgentPaused(tab.id),
  tabAgentPaused: tab.tabAgentPaused,
  inputLocked: manager.isHumanInteractionLocked(tab),
  humanInteractionLocked: tab.humanInteractionLocked
})
const GUARDED = { agentsPaused: true, tabAgentPaused: true, inputLocked: true, humanInteractionLocked: true }
const OPEN = { agentsPaused: false, tabAgentPaused: false, inputLocked: false, humanInteractionLocked: false }
const findByUrl = (manager: Manager, url: string) => [...manager.tabs.values()].find((candidate) => candidate.url === url)

describe('a paused and locked tab brought back', () => {
  it('stays paused and locked after Reopen Closed Tab', async () => {
    const { manager } = browser()
    const tab = await guardedTab(manager)
    await manager.closeTabInternal(tab.id)

    const reopened = await manager.reopenClosedTabEntry(undefined, false)

    expect(guards(manager, reopened)).toEqual(GUARDED)
  })

  it('stays paused and locked after Undo of closing it', async () => {
    const { manager, offers } = browser()
    const tab = await guardedTab(manager)
    await closeTabsForPerson(manager.personTabCloseAccess(), [tab.id])

    await offers[0]!.undo()

    expect(guards(manager, findByUrl(manager, tab.url))).toEqual(GUARDED)
  })

  it('has a paused and locked duplicate', async () => {
    const { manager } = browser()
    const tab = await guardedTab(manager)

    await manager.duplicateTabAfterLabelSave(tab.id)

    expect(guards(manager, [...manager.tabs.values()].find((candidate) => candidate.id !== tab.id))).toEqual(GUARDED)
  })

  it('stays paused and locked when its workspace is archived and restored', async () => {
    const { manager, registry } = browser()
    const tab = await guardedTab(manager)
    await registry.archive(WORKSPACE)
    expect(manager.tabs.size).toBe(0)

    await registry.restore(WORKSPACE)

    expect(guards(manager, findByUrl(manager, tab.url))).toEqual(GUARDED)
  })

  it('stays paused when it was paused before all agents were, after those are resumed', async () => {
    // Pausing all agents covers the tab's own pause without changing it; the tab brought back meanwhile keeps it.
    const { manager } = browser()
    const tab = await guardedTab(manager)
    manager.setAllAgentsPaused(true)
    await manager.closeTabInternal(tab.id)
    const reopened = await manager.reopenClosedTabEntry(undefined, false)

    manager.setAllAgentsPaused(false)

    expect(guards(manager, reopened)).toEqual(GUARDED)
  })
})

describe('a tab paused and locked only because every tab was', () => {
  // Pausing all agents and locking every tab cover each tab without changing its own pause or lock: once both are
  // turned off again, the tab brought back is open to agents and to the person.
  async function coveredTab(manager: Manager): Promise<Tab> {
    const tab = await manager.createTab({ url: 'https://docs.example/', mcpGroupId: WORKSPACE, active: false })
    manager.setAllAgentsPaused(true)
    await manager.setAllHumanInteractionLocked(true)
    expect(guards(manager, tab)).toEqual({ agentsPaused: true, tabAgentPaused: false, inputLocked: true, humanInteractionLocked: false })
    return tab
  }
  async function uncover(manager: Manager): Promise<void> {
    manager.setAllAgentsPaused(false)
    await manager.setAllHumanInteractionLocked(false)
  }

  it('comes back open after Reopen Closed Tab', async () => {
    const { manager } = browser()
    const tab = await coveredTab(manager)
    await manager.closeTabInternal(tab.id)
    await uncover(manager)

    expect(guards(manager, await manager.reopenClosedTabEntry(undefined, false))).toEqual(OPEN)
  })

  it('has an open duplicate', async () => {
    const { manager } = browser()
    const tab = await coveredTab(manager)
    await manager.duplicateTabAfterLabelSave(tab.id)
    await uncover(manager)

    expect(guards(manager, [...manager.tabs.values()].find((candidate) => candidate.id !== tab.id))).toEqual(OPEN)
  })

  it('comes back open when its workspace is archived and restored', async () => {
    const { manager, registry } = browser()
    const tab = await coveredTab(manager)
    await registry.archive(WORKSPACE)
    expect(registry.archived.get(WORKSPACE)?.tabs[0]).not.toHaveProperty('tabAgentPaused')
    expect(registry.archived.get(WORKSPACE)?.tabs[0]).not.toHaveProperty('humanInteractionLocked')
    await uncover(manager)

    await registry.restore(WORKSPACE)

    expect(guards(manager, findByUrl(manager, tab.url))).toEqual(OPEN)
  })
})
