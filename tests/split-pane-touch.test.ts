import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'

// In split view, clicking the other pane's page makes it the active pane. A touch on it did not: touch input never
// reaches Electron's before-mouse-event, so after tapping the other pane the address field, the toolbar and
// Ctrl/Cmd+W still acted on the pane the person had left.

const focused: string[] = []

vi.mock('electron', () => {
  let nextWebContentsId = 100
  class WebContentsView {
    webContents: EventEmitter & { id: number }
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

interface Tab { id: string; url: string; mcpGroupId?: string; webContents: EventEmitter & { id: number } }
/** The manager's private state these cases set up and read. */
interface Manager {
  tabs: Map<string, Tab>
  activeTabId: string | null
  splitView: unknown
  createTab(options: { url: string; mcpGroupId: string; active: boolean }): Promise<Tab>
  selectTab(tabId: string): unknown
  openSplitView(tabId: string): unknown
  pagePointerEventsAccess(): never
  tabSelectionGeneration: number
  browserContentOccluded: boolean
  allHumanInteractionLocked: boolean
  agentInputWebContents: Map<number, number>
  mcpActivityFollower: { noteHumanInput: ReturnType<typeof vi.fn> }
}

function browser() {
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
  return { manager }
}

/** The person shows two of their pages side by side and works in the left one. */
async function personInSplitView(manager: Manager) {
  const left = await manager.createTab({ url: 'https://left.example/', mcpGroupId: PERSON, active: false })
  const right = await manager.createTab({ url: 'https://right.example/', mcpGroupId: PERSON, active: false })
  attachPagePointerEvents(manager.pagePointerEventsAccess(), right as never, right.webContents as never)
  manager.selectTab(left.id)
  manager.openSplitView(right.id)
  const split = structuredClone(manager.splitView)
  return { left, right, split }
}

function touch(tab: Tab): void {
  tab.webContents.emit('input-event', { preventDefault: vi.fn() }, { type: 'touchStart' })
}

describe('a touch on the other pane of the split view', () => {
  it('makes it the active pane, as a click does', async () => {
    const { manager } = browser()
    const { right, split } = await personInSplitView(manager)
    const generation = manager.tabSelectionGeneration

    touch(right)

    expect({ splitView: manager.splitView, activeTabId: manager.activeTabId }).toEqual({ splitView: split, activeTabId: right.id })
    expect(manager.tabSelectionGeneration).toBe(generation + 1)
    expect(manager.mcpActivityFollower.noteHumanInput).toHaveBeenCalledOnce()
  })

  it('leaves the active pane while trusted chrome covers the pages', async () => {
    const { manager } = browser()
    const { left, right } = await personInSplitView(manager)
    manager.browserContentOccluded = true

    touch(right)

    expect(manager.activeTabId).toBe(left.id)
  })

  it('leaves the active pane while the human input lock holds the page', async () => {
    const { manager } = browser()
    const { left, right } = await personInSplitView(manager)
    manager.allHumanInteractionLocked = true

    touch(right)

    expect(manager.activeTabId).toBe(left.id)
  })

  it('leaves the active pane for an agent\'s touch', async () => {
    const { manager } = browser()
    const { left, right } = await personInSplitView(manager)
    manager.agentInputWebContents.set(right.webContents.id, 1)

    touch(right)

    expect(manager.activeTabId).toBe(left.id)
    expect(manager.mcpActivityFollower.noteHumanInput).not.toHaveBeenCalled()
  })
})
