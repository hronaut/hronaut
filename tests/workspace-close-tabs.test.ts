import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
vi.mock('electron', () => ({ session: {}, WebContentsView: class {}, nativeImage: {}, shell: {}, app: { getPath: () => '/tmp' }, powerMonitor: { on: () => undefined } }))
import { BrowserTabsManager } from '../src/main/browser/tabs-manager.js'
import { TabStateStore, type PersistedBrowserState } from '../src/main/browser/tab-store.js'

const CLOSING = '01912345-6789-7abc-8def-0123456789ab'
const OTHER = '01912345-678a-7abc-8def-0123456789ab'
/** The tab the person looks at, in the workspace that closes. */
const SHOWN = '01912345-678c-7abc-8def-0123456789ab'
/** A sleeping tab of the workspace that closes. */
const ASLEEP = '01912345-678d-7abc-8def-0123456789ab'
/** A sleeping tab of another workspace, which follows the shown tab once the closing workspace's tabs are gone. */
const OTHER_ASLEEP = '01912345-678e-7abc-8def-0123456789ab'
/** An awake tab of another workspace, which the person selects meanwhile. */
const OTHER_AWAKE = '01912345-678f-7abc-8def-0123456789ab'

const directories: string[] = []
afterEach(async () => { await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))) })

type Tab = ReturnType<typeof page>
interface Internals {
  tabs: Map<string, Tab>
  mcpTabGroups: Map<string, { activeTabId: string | null }>
  activeTabId: string | null
  wakeTab: ReturnType<typeof vi.fn>
  persistedState(): PersistedBrowserState
}

function page(id: string, mcpGroupId: string, sleeping = false) {
  return {
    id, mcpGroupId, url: `https://example.test/${id.slice(-2)}`, title: id.slice(-2), pinned: false, sleeping, tabMuted: false,
    humanInteractionLocked: false, tabAgentPaused: false, lastActiveAt: 0, navigationGeneration: 0,
    view: { id: `view-${id}` },
    webContents: { id: Number.parseInt(id.slice(-2), 16), isDestroyed: () => false, close: vi.fn() }
  }
}

function workspace(id: string, storageId: string, activeTabId: string) {
  return {
    id, name: `Workspace ${id.slice(-2)}`, description: '', color: 'blue', createdAt: '2026-10-19T10:00:00.000Z',
    lastUsedAt: '2026-10-19T10:00:00.000Z', activeTabId, storageId, origins: [],
    navigationPolicy: { mode: 'unrestricted', rules: [] }, navigationAudit: [], contextClass: 'standard',
    hiddenFromSidebar: false, deletionProtected: false
  }
}

/**
 * A browser showing a tab of one workspace next to a sleeping one, with another workspace holding a sleeping and an
 * awake tab. Waking a sleeping tab takes until release is called, as restoring its page does.
 */
async function browser() {
  const directory = await mkdtemp(join(tmpdir(), 'hronaut-workspace-close-'))
  directories.push(directory)
  const store = new TabStateStore(join(directory, 'tabs.json'))
  let release!: () => void
  const restored = new Promise<void>((resolve) => { release = resolve })
  const tabs = new Map([
    [SHOWN, page(SHOWN, CLOSING)], [ASLEEP, page(ASLEEP, CLOSING, true)],
    [OTHER_ASLEEP, page(OTHER_ASLEEP, OTHER, true)], [OTHER_AWAKE, page(OTHER_AWAKE, OTHER)]
  ])
  const manager = Object.assign(Object.create(BrowserTabsManager.prototype), {
    destroyed: false, initialized: true, store,
    window: { isDestroyed: () => false, isFocused: () => false, contentView: { addChildView: vi.fn(), removeChildView: vi.fn() } },
    tabs,
    mcpTabGroups: new Map([
      [CLOSING, workspace(CLOSING, '8e3da8ea-cba4-41c2-9619-a6e04a493a44', SHOWN)],
      [OTHER, workspace(OTHER, '9f4eb9fb-dcb5-42d3-a72a-b7f15b5a4b55', OTHER_AWAKE)]
    ]),
    savedTabGroups: new Map(), workspaceOperations: new Map(), savedWorkspaceOperations: new Map(),
    workspaceStorageOperation: null, pendingWorkspaceOperationPromises: new Set(), pendingTabLabels: new Set(),
    tabLabelLifecycleHolds: 0, tabLabelAdmissionClosed: false, pendingHumanTabCloses: new Map(), expectedTabClosures: new Set(), closedTabs: [],
    deletedWorkspaceStorageIds: new Set(), workspaceStorageCleanupBlocked: false,
    workspaceContinuity: { guardedWorkspaceIds: () => [] },
    allTabsMuted: false, allHumanInteractionLocked: false,
    activeTabId: SHOWN, splitView: null, tabSelectionGeneration: 0, options: {},
    reactInspectionController: { invalidateWorkspace: vi.fn() },
    networkWaitController: { reject: vi.fn() }, reproRecorder: { clearReproRecording: vi.fn() }, videoRecorder: { clear: vi.fn() },
    wakeTab: vi.fn(async (tabId: string) => {
      await restored
      const tab = tabs.get(tabId)
      if (tab) tab.sleeping = false
      return {}
    }),
    navigationHistorySnapshot: () => ({ entries: [], index: 0 }),
    cancelNativeSelectionSessions: vi.fn(), detachDialogMonitoring: vi.fn(),
    removeTabRecord: (tab: Tab) => { tabs.delete(tab.id) },
    suspendWorkspaceContinuity: vi.fn(), retireWorkspaceContinuity: vi.fn(), runWalletLifecycleAction: vi.fn(),
    layout: vi.fn(), focusTabOrTrustedChrome: vi.fn(), changed: vi.fn(), getState: () => ({})
  }) as BrowserTabsManager
  const workspaceTabs = (groupId: string) => [...tabs.values()].filter((tab) => tab.mcpGroupId === groupId).map((tab) => tab.id)
  return { manager, internals: manager as unknown as Internals, store, directory, release, workspaceTabs }
}

describe('closing a whole workspace', () => {
  it('closes every one of its tabs when the person selects another tab while the shown one hands over', async () => {
    const { manager, internals, store, directory, release, workspaceTabs } = await browser()
    // The person archives the workspace they are looking at; the tab that follows it sleeps and takes a moment to restore.
    const archiving = manager.closeMcpTabGroup(CLOSING, true)
    await vi.waitFor(() => expect(internals.wakeTab).toHaveBeenCalled())
    // Meanwhile they, or Follow agents, show a tab of another workspace.
    manager.selectTab(OTHER_AWAKE)
    release()
    await archiving

    // The shown tab stayed open with its workspace gone, and the next start refused the saved session.
    expect(internals.mcpTabGroups.has(CLOSING)).toBe(false)
    expect(workspaceTabs(CLOSING)).toEqual([])
    expect(internals.activeTabId).toBe(OTHER_AWAKE)
    await store.save(internals.persistedState())
    await expect(new TabStateStore(join(directory, 'tabs.json')).load()).resolves.toMatchObject({ activeTabId: OTHER_AWAKE })
  })

  it('does not wake its sleeping tabs only to close them', async () => {
    const { manager, internals, release, workspaceTabs } = await browser()
    release()
    await manager.closeMcpTabGroup(CLOSING, true)
    expect(workspaceTabs(CLOSING)).toEqual([])
    // Its sleeping tab used to wake, loading its site, because it followed the shown tab; now the tab that stays shows.
    expect(internals.wakeTab).not.toHaveBeenCalledWith(ASLEEP)
    expect(internals.wakeTab).toHaveBeenCalledWith(OTHER_ASLEEP)
    expect(internals.activeTabId).toBe(OTHER_ASLEEP)
  })

  it('stays open, with its tabs, when one of them is still open after the close', async () => {
    const { manager, internals, release, workspaceTabs } = await browser()
    release()
    // A close that leaves a tab behind, which the workspace must not be forgotten under.
    Object.assign(manager, { closeTabs: vi.fn(async () => ({})) })
    await expect(manager.closeMcpTabGroup(CLOSING, true)).rejects.toThrow('still has an open tab')
    expect(internals.mcpTabGroups.get(CLOSING)?.activeTabId).toBe(SHOWN)
    expect(workspaceTabs(CLOSING)).toEqual([SHOWN, ASLEEP])
  })
})

describe('closing the shown tab while the sleeping tab that follows it wakes', () => {
  it('still closes an agent\'s tab when the person selects another tab meanwhile', async () => {
    const { manager, internals, release } = await browser()
    // browser_close_tab: the agent closes the tab the person looks at, and it hands over to the sleeping tab beside it.
    const closing = manager.closeTab(SHOWN)
    await vi.waitFor(() => expect(internals.wakeTab).toHaveBeenCalledWith(ASLEEP))
    manager.selectTab(OTHER_AWAKE)
    release()
    await closing
    // The tool used to report the tab's state as if closed while it stayed open.
    expect(internals.tabs.has(SHOWN)).toBe(false)
    expect(internals.activeTabId).toBe(OTHER_AWAKE)
  })

  it('lets the person\'s own close give way to a tab they select meanwhile', async () => {
    const { manager, internals, release } = await browser()
    const closing = manager.closeTabsForPerson([SHOWN])
    await vi.waitFor(() => expect(internals.wakeTab).toHaveBeenCalledWith(ASLEEP))
    manager.selectTab(OTHER_AWAKE)
    release()
    await closing
    expect(internals.tabs.has(SHOWN)).toBe(true)
    expect(internals.activeTabId).toBe(OTHER_AWAKE)
  })
})
