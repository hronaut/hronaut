import { describe, expect, it, vi } from 'vitest'

// An agent opening its archived workspace with browser_saved_workspaces showed it in the window: it ended the
// person's split view and moved their keyboard focus into the agent's page, in another workspace, although an
// agent's other calls leave the window as it is.

const focused: string[] = []

vi.mock('electron', () => {
  let nextWebContentsId = 100
  class WebContentsView {
    webContents: Record<string, unknown>
    constructor() {
      const id = nextWebContentsId++
      this.webContents = {
        id,
        session: { partition: 'workspace' },
        isDestroyed: () => false,
        isDevToolsOpened: () => false,
        setAudioMuted() {},
        focus: () => { focused.push(String(id)) },
        isLoading: () => false,
        getURL: () => '',
        loadURL: () => Promise.resolve(),
        navigationHistory: { restore: () => Promise.resolve() }
      }
    }
    setBackgroundColor(): void {}
    setBounds(): void {}
  }
  return { session: {}, webContents: { getFocusedWebContents: () => null }, WebContentsView, nativeImage: {}, shell: {}, app: { getPath: () => '/tmp' }, powerMonitor: { on: () => undefined }, Menu: {} }
})

const { Browser } = await import('../src/main/browser/browser.js')
const { WorkspaceRegistry } = await import('../src/main/browser/workspace-registry.js')

const PERSON = '01912345-6789-7abc-8def-0123456789ab'
const AGENT = '01912345-6789-7abc-8def-0123456789ac'

interface Tab { id: string; url: string; mcpGroupId?: string; webContents: { id: number } }
interface Workspace { activeTabId: string | null }
interface Manager {
  tabs: Map<string, Tab>
  activeTabId: string | null
  splitView: unknown
  mcpTabGroups: Map<string, Workspace>
  createTab(options: { url: string; mcpGroupId: string; active: boolean }): Promise<Tab>
  selectTab(tabId: string): unknown
  openSplitView(tabId: string): unknown
  restoreSavedTabGroup(id: string): Promise<unknown>
  restoreSavedTabGroupForAgent(id: string): Promise<unknown>
}

function workspace(id: string, name: string) {
  return {
    id, name, description: '', color: 'blue' as const, createdAt: '', lastUsedAt: '', activeTabId: null,
    storageId: id === PERSON ? '8e3da8ea-cba4-41c2-9619-a6e04a493a44' : '9e3da8ea-cba4-41c2-9619-a6e04a493a45',
    origins: [], navigationPolicy: { mode: 'unrestricted' as const, rules: [] }, navigationAudit: [], contextClass: 'standard' as const
  }
}

/**
 * The real tab manager's tab creation, selection, split view and restore, with Electron's views faked so keyboard
 * focus is recorded, and a real workspace registry wired as the manager wires its own. The person's workspace is open;
 * the agent's is archived with three tabs, the middle one shown.
 */
function browser() {
  const manager = Object.assign(Object.create(Browser.prototype), {
    destroyed: false, initialized: true, restoringLayout: false,
    options: { partition: 'persist:hronaut' },
    window: {
      isDestroyed: () => false, isFocused: () => true, getContentBounds: () => ({ x: 0, y: 0, width: 1440, height: 900 }),
      webContents: { isDestroyed: () => false, getZoomFactor: () => 1, focus: () => { focused.push('window') } },
      contentView: { children: [], addChildView: vi.fn(), removeChildView: vi.fn() }
    },
    tabs: new Map(), closedTabs: [], detachedClosedTabs: new Set(), workspaceOperations: new Map(), savedWorkspaceOperations: new Map(),
    webContentsToTab: new Map(), openedTabObservations: new Map(), activeTabId: null, splitView: null, splitViewGeneration: 0,
    tabSelectionGeneration: 0, toolbarHeight: 60, contentInsets: { top: 0, right: 10, bottom: 10, left: 280 }, allTabsMuted: false,
    allAgentsPaused: false, agentPauseOverridesAllowed: true, globallyResumedAgentTabIds: new Set(),
    allHumanInteractionLocked: false, globallyUnlockedTabIds: new Set(), agentInputWebContents: new Map(),
    browserContentOccluded: false, pageFullscreenTabs: new Set(),
    assertWorkspaceNavigationAllowed: vi.fn(), workspaceNavigationAllowed: () => true, workspaceObservationGeneration: () => 0,
    roundPageCorners: vi.fn(), installSessionHooks: vi.fn(), attachTabEvents: vi.fn(), layout: vi.fn(), changed: vi.fn(),
    withTabLabelLifecycle: (run: () => Promise<unknown>) => run(), getState: () => ({}), text: (key: string) => key,
    orderedTabs(this: Manager) { return [...this.tabs.values()] }
  }) as Manager
  const opened: Array<{ url: string; loadsInTurn: boolean }> = []
  const registry: InstanceType<typeof WorkspaceRegistry> = new WorkspaceRegistry({
    maxTabs: 50,
    maxArchived: 50,
    tabs: () => [...manager.tabs.values()] as never,
    requireActive: (id) => ({ id }) as never,
    assertRestoreCapacity: () => undefined,
    withActiveOperation: (_id, _action, run) => run(),
    withArchivedOperation: (_id, _action, run) => run(),
    closeActive: async () => undefined,
    createTab: (tab) => {
      opened.push({ url: tab.url, loadsInTurn: tab.loadsInTurn })
      return manager.createTab(tab as never) as never
    },
    selectTab: (id) => { manager.selectTab(id) },
    remapDownloads: () => undefined,
    changed: () => undefined
  })
  registry.active.set(PERSON, workspace(PERSON, 'Banking'))
  registry.archived.set(AGENT, {
    ...workspace(AGENT, 'Agent research'), savedAt: '2026-10-21T09:00:00.000Z', storageOriginCount: 0,
    hiddenFromSidebar: false, deletionProtected: false, agentAccess: true, shownTabIndex: 1,
    tabs: [
      { title: 'Sources', url: 'https://agent.example/sources', pinned: false },
      { title: 'Draft', url: 'https://agent.example/draft', pinned: false },
      { title: 'Notes', url: 'https://agent.example/notes', pinned: false }
    ]
  } as never)
  Object.assign(manager, { mcpTabGroups: registry.active, savedTabGroups: registry.archived, workspaceRegistry: registry })
  return { manager, opened }
}

/** The person compares two of their pages side by side and works in one of them. */
async function personInSplitView(manager: Manager) {
  const statement = await manager.createTab({ url: 'https://bank.example/statement', mcpGroupId: PERSON, active: false })
  const transfer = await manager.createTab({ url: 'https://bank.example/transfer', mcpGroupId: PERSON, active: false })
  manager.selectTab(transfer.id)
  manager.openSplitView(statement.id)
  expect(manager.splitView).toMatchObject({ firstTabId: transfer.id, secondTabId: statement.id })
  focused.length = 0
  return { transfer, split: structuredClone(manager.splitView) }
}

const agentTab = (manager: Manager, url: string) => [...manager.tabs.values()].find((tab) => tab.url === url)!

it('opens the tab it shows at once and the others to load in their turn, a few at a time', async () => {
  // An archived workspace opened every tab's page at once.
  const shown = browser()
  await shown.manager.restoreSavedTabGroup(AGENT)
  expect(shown.opened).toEqual([
    { url: 'https://agent.example/sources', loadsInTurn: true },
    { url: 'https://agent.example/draft', loadsInTurn: false },
    { url: 'https://agent.example/notes', loadsInTurn: true }
  ])
  // Restored for an agent, the tab it shows is the agent's, which tools that do not wake tabs read.
  const hidden = browser()
  await hidden.manager.restoreSavedTabGroupForAgent(AGENT)
  expect(hidden.opened).toEqual(shown.opened)
})

describe('restoring an archived workspace', () => {
  it('for an agent leaves the person\'s split view, shown tab and keyboard focus alone', async () => {
    const { manager } = browser()
    const { transfer, split } = await personInSplitView(manager)

    await manager.restoreSavedTabGroupForAgent(AGENT)

    expect({ splitView: manager.splitView, activeTabId: manager.activeTabId, focused })
      .toEqual({ splitView: split, activeTabId: transfer.id, focused: [] })
    // Agent calls without a tab ID use the tab that was shown when it was archived.
    expect(manager.mcpTabGroups.get(AGENT)?.activeTabId).toBe(agentTab(manager, 'https://agent.example/draft').id)
  })

  it('for the person shows the tab that was shown when it was archived', async () => {
    const { manager } = browser()
    await personInSplitView(manager)

    await manager.restoreSavedTabGroup(AGENT)

    const draft = agentTab(manager, 'https://agent.example/draft')
    expect({ splitView: manager.splitView, activeTabId: manager.activeTabId, focused })
      .toEqual({ splitView: null, activeTabId: draft.id, focused: [String(draft.webContents.id)] })
    expect(manager.mcpTabGroups.get(AGENT)?.activeTabId).toBe(draft.id)
  })
})
