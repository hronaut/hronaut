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
        isLoading: () => false,
        getURL: () => '',
        loadURL: () => Promise.resolve(),
        navigationHistory: { restore: () => Promise.resolve() }
      })
    }
    setBackgroundColor(): void {}
    setBounds(): void {}
  }
  return { session: {}, webContents: { getFocusedWebContents: () => null }, WebContentsView, nativeImage: {}, shell: {}, app: { getPath: () => '/tmp' }, powerMonitor: { on: () => undefined }, Menu: {} }
})

// The prototype-built browser below stubs changed and getState; split view publishes through these.
vi.mock('../src/main/browser/browser-state/browser-state.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/main/browser/browser-state/browser-state.js')>(),
  publishChange: (browser: { changed: (persist?: boolean) => void }, persist?: boolean) => browser.changed(persist),
  browserState: (browser: { getState: () => unknown }) => browser.getState()
}))

// The prototype-built browser below stubs scheduleTabOverviewPreview, which showing a page asks for its overview preview with.
vi.mock('../src/main/browser/tab-overview-previews/tab-overview-previews.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/main/browser/tab-overview-previews/tab-overview-previews.js')>(),
  scheduleTabOverviewPreview: (browser: { scheduleTabOverviewPreview: (...args: unknown[]) => unknown }, ...args: unknown[]) => browser.scheduleTabOverviewPreview(...args)
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
const { attachPagePointerEvents } = await import('../src/main/browser/tab-events/page-pointer-events.js')
const { openSplitView } = await import('../src/main/browser/split-view/split-view.js')

const PERSON = '01912345-6789-7abc-8def-0123456789ab'

interface Tab { id: string; url: string; mcpGroupId?: string; webContents: EventEmitter & { id: number } }
/** The manager's private state these cases set up and read. */
interface Manager {
  tabs: Map<string, Tab>
  activeTabId: string | null
  splitView: unknown
  createTab(options: { url: string; mcpGroupId: string; active: boolean }): Promise<Tab>
  selectTab(tabId: string): unknown
  tabSelectionGeneration: number
  browserContentOccluded: boolean
  allHumanInteractionLocked: boolean
  agentInputWebContents: Map<number, number>
  mcpActivityFollower: { noteHumanInput: ReturnType<typeof vi.fn> }
}

function browser() {
  const manager = Object.assign(Object.create(Browser.prototype), {
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
    authorizedAgentMouseInput: new Map(),
    screenshotAreaSessions: new Map(), elementPickerSessions: new Map(), browserContentOccluded: false, pageFullscreenTabs: new Set(),
    reproRecorder: { observeReproMouse: vi.fn() }, mcpActivityFollower: { noteHumanInput: vi.fn() },
    scheduleTabOverviewPreview: vi.fn(),
    mcpTabGroups: new Map([[PERSON, {
      id: PERSON, name: 'Mine', description: '', color: 'blue', createdAt: '', lastUsedAt: '', activeTabId: null,
      storageId: '8e3da8ea-cba4-41c2-9619-a6e04a493a44', origins: [], navigationPolicy: { mode: 'unrestricted', rules: [] },
      navigationAudit: [], contextClass: 'standard'
    }]]),
    assertWorkspaceNavigationAllowed: vi.fn(), workspaceNavigationAllowed: () => true, workspaceObservationGeneration: () => 0,
    roundPageCorners: vi.fn(), installSessionHooks: vi.fn(), attachTabEvents: vi.fn(), layout: vi.fn(), changed: vi.fn(),
    getState: () => ({}), text: (key: string) => key
  }) as Manager
  return { manager }
}

/** The person shows two of their pages side by side and works in the left one. */
async function personInSplitView(manager: Manager) {
  const left = await manager.createTab({ url: 'https://left.example/', mcpGroupId: PERSON, active: false })
  const right = await manager.createTab({ url: 'https://right.example/', mcpGroupId: PERSON, active: false })
  attachPagePointerEvents(manager as never, right as never, right.webContents as never)
  manager.selectTab(left.id)
  openSplitView(manager as never, right.id)
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

  it('counts as no click, since a touch may start a scroll', async () => {
    const { manager } = browser()
    const onUserInteraction = vi.fn()
    Object.assign(manager, { options: { partition: 'persist:hronaut', onUserInteraction } })
    const { right } = await personInSplitView(manager)
    const before = (right as Tab & { humanInteractionGeneration: number }).humanInteractionGeneration

    touch(right)
    touch(right)

    // A touch scroll neither offers a take over nor expires an approval, as a wheel scroll does not.
    expect(manager.activeTabId).toBe(right.id)
    expect((right as Tab & { humanInteractionGeneration: number }).humanInteractionGeneration).toBe(before)
    expect(onUserInteraction).not.toHaveBeenCalled()
  })

  it('leaves the active pane while trusted chrome covers the pages', async () => {
    const { manager } = browser()
    const { left, right } = await personInSplitView(manager)
    manager.browserContentOccluded = true

    touch(right)

    expect(manager.activeTabId).toBe(left.id)
  })

  // The lock keeps the person's input from the page, not from choosing it: its Unlock is on the active pane's address bar.
  it('makes it the active pane while the human input lock holds the page too', async () => {
    const { manager } = browser()
    const { right } = await personInSplitView(manager)
    manager.allHumanInteractionLocked = true

    touch(right)

    expect(manager.activeTabId).toBe(right.id)
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

// A press on a pane the human input lock held never reached the code that chooses the active pane, so the address bar
// and its Unlock stayed on the other pane, though clicking either page makes it the active one.
describe('a press on the other pane of the split view while the human input lock holds it', () => {
  function press(tab: Tab, type: 'mouseDown' | 'contextMenu' | 'mouseUp' | 'mouseMove') {
    const event = { preventDefault: vi.fn() }
    tab.webContents.emit('before-mouse-event', event, { type, button: type === 'contextMenu' ? 'right' : 'left', x: 40, y: 40 })
    return event
  }

  it('makes it the active pane, and the page gets none of it', async () => {
    const { manager } = browser()
    const { left, right, split } = await personInSplitView(manager)
    manager.allHumanInteractionLocked = true

    const moved = press(right, 'mouseMove')
    expect(manager.activeTabId).toBe(left.id)
    const pressed = press(right, 'mouseDown')

    expect({ splitView: manager.splitView, activeTabId: manager.activeTabId }).toEqual({ splitView: split, activeTabId: right.id })
    expect(pressed.preventDefault).toHaveBeenCalledOnce()
    expect(moved.preventDefault).toHaveBeenCalledOnce()
  })

  it('makes it the active pane on a right-click too', async () => {
    const { manager } = browser()
    const { right } = await personInSplitView(manager)
    manager.allHumanInteractionLocked = true

    const opened = press(right, 'contextMenu')

    expect(manager.activeTabId).toBe(right.id)
    expect(opened.preventDefault).toHaveBeenCalledOnce()
  })

  it('leaves the active pane while trusted chrome covers the pages', async () => {
    const { manager } = browser()
    const { left, right } = await personInSplitView(manager)
    manager.allHumanInteractionLocked = true
    manager.browserContentOccluded = true

    press(right, 'mouseDown')

    expect(manager.activeTabId).toBe(left.id)
  })

  it('leaves the active pane for an agent\'s press the lock holds back', async () => {
    const { manager } = browser()
    const { left, right } = await personInSplitView(manager)
    manager.allHumanInteractionLocked = true
    manager.agentInputWebContents.set(right.webContents.id, 1)

    const pressed = press(right, 'mouseDown')

    expect(manager.activeTabId).toBe(left.id)
    expect(pressed.preventDefault).toHaveBeenCalledOnce()
  })
})
