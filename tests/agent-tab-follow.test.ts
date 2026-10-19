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
      loadURL: () => Promise.resolve(),
      navigationHistory: { restore: () => Promise.resolve() }
    }
    setBackgroundColor(): void {}
    setBounds(bounds: { x: number; y: number; width: number; height: number }): void { viewBounds.push(bounds) }
  }
  return { session: {}, WebContentsView, nativeImage: {}, shell: {}, app: { getPath: () => '/tmp' }, powerMonitor: { on: () => undefined } }
})
import type { WebContents } from 'electron'
import { BrowserTabsManager } from '../src/main/browser/tabs-manager.js'
import { attachWindowOpenHandler } from '../src/main/browser/tab-events/window-open-handler.js'
import type { WindowOpenHandlerAccess, WindowOpenHandlerTab } from '../src/main/browser/tab-events/window-open-handler-access.js'

/** The manager's private state these cases set up and read. */
interface ManagerInternals {
  activeTabId: string | null
  tabs: Map<string, unknown>
  mcpTabGroups: Map<string, { activeTabId: string | null }>
  agentInputWebContents: Map<number, number>
  focusTabOrTrustedChrome: ReturnType<typeof vi.fn>
  createTab: ReturnType<typeof vi.fn>
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
    view: { id: 'agent-view' }, webContents: { id: 2, isDestroyed: () => false }
  }
  const manager = Object.assign(Object.create(BrowserTabsManager.prototype), {
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
    tabs: new Map<string, unknown>([[video.id, video], [agentTab.id, agentTab]]),
    mcpTabGroups: new Map([['Mine', workspace('Mine', video.id)], ['Agent', workspace('Agent', agentTab.id)]]),
    workspaceOperations: new Map(),
    webContentsToTab: new Map(),
    openedTabObservations: new Map(),
    agentInputWebContents: new Map(),
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
  }) as BrowserTabsManager
  const internals = manager as unknown as ManagerInternals
  return { manager, internals, agentTab }
}

describe('a tab an agent opens or selects while Follow agents is on', () => {
  const waits = {
    'a page the person watches fills the window in full screen': { pageFullscreen: true },
    'the person types in the address field': { followAgentActivitySuspended: true },
    'trusted chrome, such as Settings, covers the pages': { browserContentOccluded: true }
  }
  for (const [reason, options] of Object.entries(waits)) {
    it(`becomes its workspace's active tab without taking the view while ${reason}`, async () => {
      // The agent's new tab used to be shown at once, taking a video out of full screen, as no Follow safeguard applied.
      const { manager, internals } = fixture(options)
      await manager.newAgentTab({ url: 'https://agent.test/new', mcpGroupId: 'Agent', focus: false })
      expect(internals.activeTabId).toBe('video')
      const opened = [...internals.tabs.keys()].find((id) => id !== 'video' && id !== 'agent-tab')
      expect(internals.mcpTabGroups.get('Agent')?.activeTabId).toBe(opened)
    })
  }

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
    let openWindow!: (details: { url: string; disposition: string; referrer: { url: string; policy: string } }) => unknown
    const webContents = { id: agentTab.webContents.id, setWindowOpenHandler: (handler: typeof openWindow) => { openWindow = handler } }
    attachWindowOpenHandler(internals.windowOpenHandlerAccess(), agentTab, webContents as unknown as WebContents)
    const details = { url: 'https://agent.test/child', disposition: 'foreground-tab', referrer: { url: '', policy: 'default' } }

    internals.agentInputWebContents.set(agentTab.webContents.id, 1)
    openWindow(details)
    expect(internals.createTab).toHaveBeenLastCalledWith(expect.objectContaining({ active: true, selectVisible: false }))
    internals.agentInputWebContents.clear()
    openWindow(details)
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
