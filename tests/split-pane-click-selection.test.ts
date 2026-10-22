import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'

// In split view, "click either page or either marked tab to make it the active pane". The person clicks a sleeping
// tab, changes their mind while it wakes and goes back to work in the right-hand page of their split view. When the
// sleeping tab finished waking it still replaced the split view and took keyboard focus. Picking the same pane by its
// marked tab instead did cancel the older selection, because only selecting a tab advanced the selection generation;
// the page click that makes a pane active did not.

const focused: string[] = []

vi.mock('electron', () => {
  let nextWebContentsId = 100
  class WebContentsView {
    webContents: Record<string, unknown>
    constructor() {
      const id = nextWebContentsId++
      const events = new EventEmitter()
      this.webContents = Object.assign(events, {
        id,
        session: { partition: 'workspace' },
        isDestroyed: () => false,
        isDevToolsOpened: () => false,
        setAudioMuted() {},
        focus: () => { focused.push(String(id)) },
        loadURL: () => Promise.resolve(),
        navigationHistory: { restore: () => Promise.resolve() }
      })
    }
    setBackgroundColor(): void {}
    setBounds(): void {}
  }
  return { session: {}, webContents: { getFocusedWebContents: () => null }, WebContentsView, nativeImage: {}, shell: {}, app: { getPath: () => '/tmp' }, powerMonitor: { on: () => undefined }, Menu: {} }
})

const { BrowserTabsManager } = await import('../src/main/browser/tabs-manager.js')
const { attachPagePointerEvents } = await import('../src/main/browser/tab-events/page-pointer-events.js')

const PERSON = '01912345-6789-7abc-8def-0123456789ab'

interface Tab { id: string; url: string; sleeping: boolean; mcpGroupId?: string; webContents: EventEmitter & { id: number } }
/** The manager's private state these cases set up and read. */
interface Manager {
  tabs: Map<string, Tab>
  activeTabId: string | null
  splitView: unknown
  wakeTab: (tabId: string) => Promise<unknown>
  createTab(options: { url: string; mcpGroupId: string; active: boolean }): Promise<Tab>
  selectTab(tabId: string): unknown
  selectTabAndWait(tabId: string): Promise<unknown>
  openSplitView(tabId: string): unknown
  pagePointerEventsAccess(): never
}

function browser() {
  let finishWake!: () => void
  const waking = new Promise<void>((resolve) => { finishWake = resolve })
  const manager = Object.assign(Object.create(BrowserTabsManager.prototype), {
    destroyed: false, initialized: true, restoringLayout: false,
    options: { partition: 'persist:hronaut' },
    window: {
      isDestroyed: () => false, isFocused: () => true, getContentBounds: () => ({ x: 0, y: 0, width: 1440, height: 900 }),
      webContents: { isDestroyed: () => false, getZoomFactor: () => 1, focus: () => { focused.push('shell') } },
      contentView: { children: [], addChildView: vi.fn(), removeChildView: vi.fn() }
    },
    tabs: new Map(), closedTabs: [], detachedClosedTabs: new Set(), workspaceOperations: new Map(),
    webContentsToTab: new Map(), openedTabObservations: new Map(), activeTabId: null, splitView: null, splitViewGeneration: 0,
    tabSelectionGeneration: 0, toolbarHeight: 60, contentInsets: { top: 0, right: 10, bottom: 10, left: 280 }, allTabsMuted: false,
    allHumanInteractionLocked: false, globallyUnlockedTabIds: new Set(), agentInputWebContents: new Map(), agentWheel: new Map(),
    screenshotAreaSessions: new Map(), elementPickerSessions: new Map(), browserContentOccluded: false, pageFullscreenTabs: new Set(),
    reproRecorder: { observeReproMouse: vi.fn() }, mcpActivityFollower: { noteHumanInput: vi.fn() },
    scheduleTabOverviewPreview: vi.fn(), shouldBlockHumanMouseInput: () => false, agentWheelUnderWay: () => false,
    mcpTabGroups: new Map([[PERSON, {
      id: PERSON, name: 'Mine', description: '', color: 'blue', createdAt: '', lastUsedAt: '', activeTabId: null,
      storageId: '8e3da8ea-cba4-41c2-9619-a6e04a493a44', origins: [], navigationPolicy: { mode: 'unrestricted', rules: [] },
      navigationAudit: [], contextClass: 'standard'
    }]]),
    assertWorkspaceNavigationAllowed: vi.fn(), workspaceNavigationAllowed: () => true, workspaceObservationGeneration: () => 0,
    roundPageCorners: vi.fn(), installSessionHooks: vi.fn(), attachTabEvents: vi.fn(), layout: vi.fn(), changed: vi.fn(),
    getState: () => ({}), text: (key: string) => key,
    orderedTabs(this: Manager) { return [...this.tabs.values()] }
  }) as Manager
  // Restoring a sleeping page takes until the test lets it finish, as loading a slow site does.
  manager.wakeTab = vi.fn(async (tabId: string) => {
    await waking
    manager.tabs.get(tabId)!.sleeping = false
    return {}
  })
  return { manager, finishWake }
}

async function personInSplitViewWithASleepingTab(manager: Manager) {
  const left = await manager.createTab({ url: 'https://left.example/', mcpGroupId: PERSON, active: false })
  const right = await manager.createTab({ url: 'https://right.example/', mcpGroupId: PERSON, active: false })
  const sleeper = await manager.createTab({ url: 'https://slow.example/', mcpGroupId: PERSON, active: false })
  sleeper.sleeping = true
  attachPagePointerEvents(manager.pagePointerEventsAccess(), right as never, right.webContents as never)
  manager.selectTab(left.id)
  manager.openSplitView(right.id)
  const split = structuredClone(manager.splitView)
  focused.length = 0
  return { left, right, sleeper, split }
}

describe('a sleeping tab the person clicked, then went back to their split view while it woke', () => {
  it('stays in the background when the person clicked the other pane\'s page', async () => {
    const { manager, finishWake } = browser()
    const { right, sleeper, split } = await personInSplitViewWithASleepingTab(manager)

    const selecting = manager.selectTabAndWait(sleeper.id)
    // The person clicks into the right-hand page, which makes it the active pane.
    right.webContents.emit('before-mouse-event', { preventDefault: vi.fn() }, { type: 'mouseDown', button: 'left', x: 40, y: 40 })
    expect(manager.activeTabId).toBe(right.id)
    finishWake()
    await selecting

    expect({ splitView: manager.splitView, activeTabId: manager.activeTabId, focused })
      .toEqual({ splitView: split, activeTabId: right.id, focused: [] })
  })

  it('stays in the background when the person clicked the other pane\'s marked tab', async () => {
    const { manager, finishWake } = browser()
    const { right, sleeper, split } = await personInSplitViewWithASleepingTab(manager)

    const selecting = manager.selectTabAndWait(sleeper.id)
    await manager.selectTabAndWait(right.id)
    focused.length = 0
    finishWake()
    await selecting

    expect({ splitView: manager.splitView, activeTabId: manager.activeTabId, focused })
      .toEqual({ splitView: split, activeTabId: right.id, focused: [] })
  })
})
