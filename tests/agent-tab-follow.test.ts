import { describe, expect, it, vi } from 'vitest'
const viewBounds = vi.hoisted(() => [] as Array<{ x: number; y: number; width: number; height: number }>)
vi.mock('electron', () => {
  let nextWebContentsId = 100
  class WebContentsView {
    webContents = {
      id: nextWebContentsId++,
      session: {},
      isDestroyed: () => false,
      setAudioMuted: () => undefined,
      isLoading: () => false,
      getURL: () => '',
      loadURL: () => Promise.resolve(),
      navigationHistory: { restore: () => Promise.resolve() }
    }
    setBackgroundColor(): void {}
    setBounds(bounds: { x: number; y: number; width: number; height: number }): void { viewBounds.push(bounds) }
  }
  return { session: {}, WebContentsView, nativeImage: {}, shell: {}, app: { getPath: () => '/tmp' }, powerMonitor: { on: () => undefined } }
})
// The prototype-built browser below stubs getState, assertWorkspaceNavigationAllowed, assertTabLabelAdmission and
// saveTabLabel, which opening an agent's tab publishes, checks the workspace's sites and saves its label through.
vi.mock('../src/main/browser/browser-state/browser-state.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/main/browser/browser-state/browser-state.js')>(),
  browserState: (browser: { getState: () => unknown }) => browser.getState()
}))
vi.mock('../src/main/browser/workspace-navigation/workspace-navigation.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/main/browser/workspace-navigation/workspace-navigation.js')>(),
  assertWorkspaceNavigationAllowed: (browser: { assertWorkspaceNavigationAllowed: (...args: unknown[]) => void }, ...args: unknown[]) => (
    browser.assertWorkspaceNavigationAllowed(...args)
  )
}))
vi.mock('../src/main/browser/tab-labels/tab-labels.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/main/browser/tab-labels/tab-labels.js')>(),
  assertTabLabelAdmission: (browser: { assertTabLabelAdmission: () => void }) => browser.assertTabLabelAdmission(),
  saveTabLabel: (browser: { saveTabLabel: (...args: unknown[]) => unknown }, ...args: unknown[]) => browser.saveTabLabel(...args)
}))
import type { WebContents } from 'electron'
import { Browser } from '../src/main/browser/browser.js'
import { McpActivityFollowController } from '../src/main/browser/mcp-activity-follow-controller.js'
import { attachWindowOpenHandler } from '../src/main/browser/tab-events/window-open-handler.js'
import type { WindowOpenHandlerAccess, WindowOpenHandlerTab } from '../src/main/browser/tab-events/window-open-handler-access.js'

/** The manager's private state these cases set up and read. */
interface ManagerInternals {
  activeTabId: string | null
  tabs: Map<string, { sleeping: boolean; webContents: { isDestroyed(): boolean } }>
  mcpTabGroups: Map<string, { activeTabId: string | null }>
  agentInputWebContents: Map<number, number>
  window: { isFocused(): boolean }
  tabSelectionGeneration: number
  followAgentActivity: boolean
  browserContentOccluded: boolean
  followAgentActivitySuspended: boolean
  mcpActivityFollower: McpActivityFollowController
  focusTabOrTrustedChrome: ReturnType<typeof vi.fn>
  createTab: ReturnType<typeof vi.fn>
  wakeTab: (tabId: string) => Promise<unknown>
  assertTabLabelAdmission: () => void
  saveTabLabel: (tabId: string, value: string, validateAuthority?: () => void, onCommitted?: () => void) => Promise<{ state: unknown; status: 'saved' }>
  pageFullscreenShown(): boolean
  selectTabPassively(tabId: string): boolean
  windowOpenHandlerAccess(): WindowOpenHandlerAccess<WindowOpenHandlerTab>
}

function workspace(id: string, activeTabId: string | null = null) {
  return {
    id, name: id, description: '', color: 'blue', createdAt: '', lastUsedAt: '', activeTabId,
    storageId: `storage-${id}`, origins: [], navigationPolicy: { mode: 'open', rules: [] }, navigationAudit: [],
    contextClass: 'standard', deletionProtected: false
  }
}

/** The person watches a video in their workspace while an agent works in its own, with Follow agents on. */
function fixture(options: { pageFullscreen?: boolean; followAgentActivitySuspended?: boolean; browserContentOccluded?: boolean } = {}) {
  const video = {
    id: 'video', url: 'https://video.test/watch', mcpGroupId: 'Mine', sleeping: false, pinned: false, lastActiveAt: 0,
    pageFullscreen: options.pageFullscreen ?? false, view: { id: 'video-view' }, webContents: { id: 1, isDestroyed: () => false }
  }
  const agentTab = {
    id: 'agent-tab', url: 'https://agent.test/', mcpGroupId: 'Agent', sleeping: false, pinned: false, lastActiveAt: 0,
    view: { id: 'agent-view' }, webContents: { id: 2, isDestroyed: vi.fn(() => false) }
  }
  const agentOther = {
    id: 'agent-other', url: 'https://agent.test/other', mcpGroupId: 'Agent', sleeping: false, pinned: false, lastActiveAt: 0,
    view: { id: 'agent-other-view' }, webContents: { id: 3, isDestroyed: () => false }
  }
  const manager = Object.assign(Object.create(Browser.prototype), {
    destroyed: false,
    initialized: true,
    restoringLayout: false,
    options: { partition: 'persist:hronaut' },
    window: {
      isDestroyed: () => false,
      isFocused: () => true,
      getContentBounds: () => ({ x: 0, y: 0, width: 1440, height: 900 }),
      webContents: { isDestroyed: () => false, getZoomFactor: () => 1 },
      contentView: { children: [video.view], addChildView: vi.fn(), removeChildView: vi.fn() }
    },
    tabs: new Map<string, unknown>([[video.id, video], [agentTab.id, agentTab], [agentOther.id, agentOther]]),
    mcpTabGroups: new Map([['Mine', workspace('Mine', video.id)], ['Agent', workspace('Agent', agentTab.id)]]),
    workspaceOperations: new Map(),
    webContentsToTab: new Map(),
    openedTabObservations: new Map(),
    agentInputWebContents: new Map(),
    mcpActivitiesByTab: new Map(),
    activeTabId: video.id,
    splitView: null,
    tabSelectionGeneration: 0,
    toolbarHeight: 60,
    contentInsets: { top: 0, right: 10, bottom: 10, left: 280 },
    allTabsMuted: false,
    followAgentActivity: true,
    browserContentOccluded: options.browserContentOccluded ?? false,
    followAgentActivitySuspended: options.followAgentActivitySuspended ?? false,
    assertWorkspaceNavigationAllowed: vi.fn(),
    workspaceNavigationAllowed: () => true,
    workspaceObservationGeneration: () => 0,
    roundPageCorners: vi.fn(),
    installSessionHooks: vi.fn(),
    attachTabEvents: vi.fn(),
    layout: vi.fn(),
    focusTabOrTrustedChrome: vi.fn(),
    wakeTab: vi.fn(async () => ({})),
    changed: vi.fn(),
    getState: () => ({ activeTabId: internals.activeTabId })
  }) as Browser
  const internals = manager as unknown as ManagerInternals
  return { manager, internals, agentTab }
}

/** Follow agents as the manager's constructor wires it, for the cases that drive an agent's call through it. */
function followAgents(internals: ManagerInternals): McpActivityFollowController {
  internals.mcpActivityFollower = new McpActivityFollowController({
    isEnabled: () => internals.followAgentActivity,
    isOccluded: () => internals.browserContentOccluded || internals.followAgentActivitySuspended || internals.pageFullscreenShown(),
    getSelectionGeneration: () => internals.tabSelectionGeneration,
    tabExists: (tabId) => internals.tabs.get(tabId)?.webContents.isDestroyed() === false,
    canSelectWithoutWake: (tabId) => internals.tabs.get(tabId)?.sleeping === false,
    wakeTab: (tabId) => internals.wakeTab(tabId),
    selectTabPassively: (tabId) => internals.selectTabPassively(tabId),
    onError: (error) => { throw error }
  })
  return internals.mcpActivityFollower
}

/** The id of the one tab opened since the snapshot of tab ids. */
function openedSince(internals: ManagerInternals, before: ReadonlySet<string>): string | undefined {
  return [...internals.tabs.keys()].find((id) => !before.has(id))
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((accept) => { resolve = accept })
  return { promise, resolve }
}

describe('a tab an agent opens or selects while Follow agents is on', () => {
  it('never takes the view itself, whatever Follow waits for, and becomes its workspace\'s active tab', async () => {
    // The agent's new or selected tab used to be shown at once, past every Follow safeguard. Opening and selecting
    // read none of them now: Follow shows the tab through the agent's call on it, which is where its waits apply.
    for (const options of [{}, { pageFullscreen: true }, { followAgentActivitySuspended: true }, { browserContentOccluded: true }]) {
      const { manager, internals } = fixture(options)
      const before = new Set(internals.tabs.keys())
      await manager.newAgentTab({ url: 'https://agent.test/new', mcpGroupId: 'Agent', focus: false })
      expect(internals.activeTabId).toBe('video')
      expect(internals.mcpTabGroups.get('Agent')?.activeTabId).toBe(openedSince(internals, before))
      await manager.selectAgentTabAndWait('agent-tab')
      expect(internals.activeTabId).toBe('video')
      expect(internals.mcpTabGroups.get('Agent')?.activeTabId).toBe('agent-tab')
      expect(internals.focusTabOrTrustedChrome).not.toHaveBeenCalled()
    }
  })

  it('opens a labeled tab without taking the view either', async () => {
    const { manager, internals } = fixture()
    internals.assertTabLabelAdmission = vi.fn()
    internals.saveTabLabel = vi.fn(async (_tabId: string, _value: string, _validate?: () => void, onCommitted?: () => void) => {
      onCommitted?.()
      return { state: {}, status: 'saved' as const }
    })
    const saved = await manager.newLabeledAgentTab({ url: 'https://agent.test/labeled', mcpGroupId: 'Agent', focus: false }, 'Checkout', () => undefined, () => undefined, () => undefined)
    expect(saved.labelPersistence).toBe('saved')
    expect(internals.activeTabId).toBe('video')
    expect(internals.mcpTabGroups.get('Agent')?.activeTabId).toBe(saved.createdTabId)
  })

  it('still shows the agent\'s new tab through Follow agents with the agent\'s call on it when nothing waits', async () => {
    const { manager, internals } = fixture()
    const follower = followAgents(internals)
    // Passive selection keeps a focused window's keyboard focus in trusted chrome, which needs a real page.
    internals.window.isFocused = () => false
    const before = new Set(internals.tabs.keys())
    await manager.newAgentTab({ url: 'https://agent.test/new', mcpGroupId: 'Agent', focus: false })
    const opened = openedSince(internals, before)!
    expect(internals.activeTabId).toBe('video')
    manager.handleMcpTabActivity({ activityId: 'new-tab', tabId: opened, toolName: 'browser_new_tab', phase: 'started', occurredAt: Date.now() }, { id: 'agent', name: 'Agent' })
    expect(internals.activeTabId).toBe(opened)
    expect(internals.focusTabOrTrustedChrome).not.toHaveBeenCalled()
    follower.dispose()
  })

  it('names the agent\'s new tab as soon as it exists', async () => {
    const { manager, internals } = fixture()
    const before = new Set(internals.tabs.keys())
    const created: string[] = []
    const opening = manager.newAgentTab({ url: 'https://agent.test/named', mcpGroupId: 'Agent', focus: false }, (tabId) => { created.push(tabId) })
    expect(created).toEqual([openedSince(internals, before)])
    await opening
  })

  it('marks the agent\'s tab active in its workspace once it wakes', async () => {
    const { manager, internals } = fixture()
    const wake = deferred()
    internals.wakeTab = vi.fn(() => wake.promise)
    const selecting = manager.selectAgentTabAndWait('agent-other')
    expect(internals.mcpTabGroups.get('Agent')?.activeTabId).toBe('agent-tab')
    wake.resolve()
    await selecting
    expect(internals.mcpTabGroups.get('Agent')?.activeTabId).toBe('agent-other')
    expect(internals.activeTabId).toBe('video')
  })

  it('keeps the tab the person picks in that workspace while the agent\'s tab wakes', async () => {
    const { manager, internals } = fixture()
    const wake = deferred()
    internals.wakeTab = vi.fn(() => wake.promise)
    const selecting = manager.selectAgentTabAndWait('agent-tab')
    manager.selectTab('agent-other')
    wake.resolve()
    await selecting
    // The agent's selection used to land after the wake and replace the person's pick.
    expect(internals.mcpTabGroups.get('Agent')?.activeTabId).toBe('agent-other')
    expect(internals.activeTabId).toBe('agent-other')
  })

  it('still makes the agent\'s tab active in its workspace when the person picks a tab in another workspace meanwhile', async () => {
    const { manager, internals } = fixture()
    internals.mcpTabGroups.get('Agent')!.activeTabId = null
    const wake = deferred()
    internals.wakeTab = vi.fn(() => wake.promise)
    const selecting = manager.selectAgentTabAndWait('agent-tab')
    manager.selectTab('video')
    wake.resolve()
    await selecting
    expect(internals.mcpTabGroups.get('Agent')?.activeTabId).toBe('agent-tab')
    expect(internals.activeTabId).toBe('video')
  })

  it('reports a tab whose renderer ended while it woke', async () => {
    const { manager, internals, agentTab } = fixture()
    internals.mcpTabGroups.get('Agent')!.activeTabId = null
    const wake = deferred()
    internals.wakeTab = vi.fn(() => wake.promise)
    const selecting = manager.selectAgentTabAndWait('agent-tab')
    agentTab.webContents.isDestroyed.mockReturnValue(true)
    wake.resolve()
    await expect(selecting).rejects.toThrow('This tab renderer is no longer available')
    expect(internals.mcpTabGroups.get('Agent')?.activeTabId).toBeNull()
  })

  it('leaves the page the person watches in full screen in view when the agent selects one of its tabs', async () => {
    const { manager, internals } = fixture({ pageFullscreen: true })
    internals.mcpTabGroups.get('Agent')!.activeTabId = null
    await manager.selectAgentTabAndWait('agent-tab')
    expect(internals.activeTabId).toBe('video')
    expect(internals.focusTabOrTrustedChrome).not.toHaveBeenCalled()
    expect(internals.mcpTabGroups.get('Agent')?.activeTabId).toBe('agent-tab')
  })

  it('opens the window an agent\'s click asks for without showing it, unlike one the person opens', () => {
    const { internals, agentTab } = fixture({ pageFullscreen: true })
    internals.createTab = vi.fn(async () => ({ id: 'popup' }))
    type Response = { createWindow(options: { webContents: WebContents }): WebContents }
    let openWindow!: (details: { url: string; disposition: string; referrer: { url: string; policy: string } }) => Response
    const webContents = { id: agentTab.webContents.id, setWindowOpenHandler: (handler: typeof openWindow) => { openWindow = handler } }
    attachWindowOpenHandler(internals.windowOpenHandlerAccess(), agentTab as unknown as WindowOpenHandlerTab, webContents as unknown as WebContents)
    const details = { url: 'https://agent.test/child', disposition: 'foreground-tab', referrer: { url: '', policy: 'default' } }
    const guest = { isDestroyed: () => false } as unknown as WebContents

    internals.agentInputWebContents.set(agentTab.webContents.id, 1)
    openWindow(details).createWindow({ webContents: guest })
    expect(internals.createTab).toHaveBeenLastCalledWith(expect.objectContaining({ active: true, selectVisible: false }))
    internals.agentInputWebContents.clear()
    openWindow(details).createWindow({ webContents: guest })
    expect(internals.createTab).toHaveBeenLastCalledWith(expect.objectContaining({ active: true, selectVisible: true }))
  })
})

describe('a tab opened behind a page in full screen', () => {
  it('gets the page card\'s size, not the whole window the page in full screen fills', async () => {
    // A background tab used to be sized for the whole window, so its page and captures had a size it never shows at.
    const { manager } = fixture({ pageFullscreen: true })
    await manager.newAgentTab({ url: 'https://agent.test/background', mcpGroupId: 'Agent', active: false, focus: false })
    expect(viewBounds.at(-1)).toEqual({ x: 280, y: 60, width: 1150, height: 830 })
  })
})
