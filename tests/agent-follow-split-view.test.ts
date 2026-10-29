import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'

// The person puts an agent's tab beside their own in split view to watch it, with Follow agents on, and works in
// their own pane. The agent's tab was already in view, yet each agent call on it (once the person paused for 3 s)
// made Follow switch the active pane to the agent's tab and move keyboard focus out of the person's page into the
// shell: the next keys the person typed went nowhere, and the toolbar, Ctrl/Cmd+L and Ctrl/Cmd+W acted on the
// agent's tab.

const focused: string[] = []
const electronFocus = vi.hoisted(() => ({ id: null as number | null }))

vi.mock('electron', () => {
  let nextWebContentsId = 100
  class WebContentsView {
    webContents: Record<string, unknown>
    constructor() {
      const id = nextWebContentsId++
      const events = new EventEmitter()
      this.webContents = {
        id,
        session: { partition: 'workspace' },
        isDestroyed: () => false,
        isDevToolsOpened: () => false,
        setAudioMuted() {},
        on: (name: string, listener: (...args: unknown[]) => void) => events.on(name, listener),
        once: (name: string, listener: (...args: unknown[]) => void) => events.once(name, listener),
        removeListener: (name: string, listener: (...args: unknown[]) => void) => events.removeListener(name, listener),
        focus: () => { focused.push(String(id)); electronFocus.id = id },
        isLoading: () => false,
        getURL: () => '',
        loadURL: () => Promise.resolve(),
        navigationHistory: { restore: () => Promise.resolve() }
      }
    }
    setBackgroundColor(): void {}
    setBounds(): void {}
  }
  return {
    session: {}, webContents: { getFocusedWebContents: () => (electronFocus.id === null ? null : { id: electronFocus.id }) },
    WebContentsView, nativeImage: {}, shell: {}, app: { getPath: () => '/tmp' }, powerMonitor: { on: () => undefined }, Menu: {}
  }
})

const { Browser } = await import('../src/main/browser/browser.js')
const { McpActivityFollowController } = await import('../src/main/browser/mcp-activity-follow-controller.js')

const PERSON = '01912345-6789-7abc-8def-0123456789ab'
const AGENT = '01912345-6789-7abc-8def-0123456789ac'

interface Tab { id: string; webContents: { id: number; isDestroyed(): boolean }; sleeping: boolean }
/** The manager's private state these cases set up and read. */
interface Manager {
  tabs: Map<string, Tab>
  activeTabId: string | null
  splitView: unknown
  tabSelectionGeneration: number
  followAgentActivity: boolean
  browserContentOccluded: boolean
  followAgentActivitySuspended: boolean
  mcpActivityFollower: InstanceType<typeof McpActivityFollowController>
  createTab(options: { url: string; mcpGroupId: string; active: boolean }): Promise<Tab>
  selectTab(tabId: string): unknown
  openSplitView(tabId: string): unknown
  selectTabPassively(tabId: string): boolean
  pageFullscreenShown(): boolean
  wakeTab(tabId: string): Promise<unknown>
}

function workspace(id: string, storageId: string) {
  return {
    id, name: id, description: '', color: 'blue' as const, createdAt: '', lastUsedAt: '', activeTabId: null, storageId,
    origins: [], navigationPolicy: { mode: 'unrestricted' as const, rules: [] }, navigationAudit: [], contextClass: 'standard' as const
  }
}

/** The real tab manager's tab creation, selection, split view and passive selection, with Electron's views faked. */
function browser(): Manager {
  const manager = Object.assign(Object.create(Browser.prototype), {
    destroyed: false, initialized: true, restoringLayout: false,
    options: { partition: 'persist:hronaut' },
    window: {
      isDestroyed: () => false, isFocused: () => true, getContentBounds: () => ({ x: 0, y: 0, width: 1440, height: 900 }),
      webContents: { isDestroyed: () => false, getZoomFactor: () => 1, focus: () => { focused.push('shell'); electronFocus.id = 1 } },
      contentView: { children: [], addChildView: vi.fn(), removeChildView: vi.fn() }
    },
    tabs: new Map(), closedTabs: [], detachedClosedTabs: new Set(), workspaceOperations: new Map(),
    webContentsToTab: new Map(), openedTabObservations: new Map(), activeTabId: null, splitView: null, splitViewGeneration: 0,
    tabSelectionGeneration: 0, toolbarHeight: 60, contentInsets: { top: 0, right: 10, bottom: 10, left: 280 }, allTabsMuted: false,
    allHumanInteractionLocked: false, globallyUnlockedTabIds: new Set(), agentInputWebContents: new Map(),
    browserContentOccluded: false, followAgentActivity: true, followAgentActivitySuspended: false, mcpActivitiesByTab: new Map(),
    pageFullscreenTabs: new Set(),
    mcpTabGroups: new Map([[PERSON, workspace(PERSON, '8e3da8ea-cba4-41c2-9619-a6e04a493a44')], [AGENT, workspace(AGENT, '9e3da8ea-cba4-41c2-9619-a6e04a493a45')]]),
    assertWorkspaceNavigationAllowed: vi.fn(), workspaceNavigationAllowed: () => true, workspaceObservationGeneration: () => 0,
    roundPageCorners: vi.fn(), installSessionHooks: vi.fn(), attachTabEvents: vi.fn(), layout: vi.fn(), changed: vi.fn(),
    getState: () => ({}), text: (key: string) => key,
    orderedTabs(this: Manager) { return [...this.tabs.values()] }
  }) as Manager
  // Follow agents, wired as the manager's constructor wires it.
  manager.mcpActivityFollower = new McpActivityFollowController({
    isEnabled: () => manager.followAgentActivity,
    isOccluded: () => manager.browserContentOccluded || manager.followAgentActivitySuspended || manager.pageFullscreenShown(),
    getSelectionGeneration: () => manager.tabSelectionGeneration,
    tabExists: (tabId) => manager.tabs.get(tabId)?.webContents.isDestroyed() === false,
    canSelectWithoutWake: (tabId) => manager.tabs.get(tabId)?.sleeping === false,
    wakeTab: (tabId) => manager.wakeTab(tabId),
    selectTabPassively: (tabId) => manager.selectTabPassively(tabId),
    onError: (error) => { throw error }
  })
  return manager
}

/** The agent starts a call on its tab. */
function agentCall(manager: Manager, tabId: string): void {
  manager.mcpActivityFollower.accept(
    { activityId: `call-${tabId}`, tabId, phase: 'started', toolName: 'browser_click', occurredAt: Date.now() } as never,
    { id: 'agent-session', name: 'Claude' }
  )
}

describe('Follow agents with the person\'s split view', () => {
  it('leaves the person\'s active pane and keyboard focus alone when the agent works in the other pane', async () => {
    const manager = browser()
    const notes = await manager.createTab({ url: 'https://notes.example/draft', mcpGroupId: PERSON, active: false })
    const agentTab = await manager.createTab({ url: 'https://agent.example/run', mcpGroupId: AGENT, active: false })
    // The person shows the agent's tab beside their own notes and types in the notes.
    manager.selectTab(notes.id)
    manager.openSplitView(agentTab.id)
    const split = structuredClone(manager.splitView)
    expect(electronFocus.id).toBe(notes.webContents.id)
    focused.length = 0

    agentCall(manager, agentTab.id)

    expect({ splitView: manager.splitView, activeTabId: manager.activeTabId, focused, keyboardFocusIn: electronFocus.id })
      .toEqual({ splitView: split, activeTabId: notes.id, focused: [], keyboardFocusIn: notes.webContents.id })
  })

  it('still shows an agent\'s tab that is out of view, keeping keyboard focus out of the agent\'s page', async () => {
    const manager = browser()
    const notes = await manager.createTab({ url: 'https://notes.example/draft', mcpGroupId: PERSON, active: false })
    const reference = await manager.createTab({ url: 'https://notes.example/reference', mcpGroupId: PERSON, active: false })
    const agentTab = await manager.createTab({ url: 'https://agent.example/run', mcpGroupId: AGENT, active: false })
    manager.selectTab(notes.id)
    manager.openSplitView(reference.id)
    focused.length = 0

    agentCall(manager, agentTab.id)

    expect({ activeTabId: manager.activeTabId, focused, keyboardFocusIn: electronFocus.id })
      .toEqual({ activeTabId: agentTab.id, focused: ['shell'], keyboardFocusIn: 1 })
  })
})
