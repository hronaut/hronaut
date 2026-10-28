import { expect, it, vi } from 'vitest'

const pages = vi.hoisted(() => ({ loads: [] as string[] }))

vi.mock('electron', () => {
  let nextWebContentsId = 100
  class WebContentsView {
    // As in Electron, the address is the last committed one: a load that just started has none until it commits.
    webContents = (() => {
      let committed = ''
      let loading = false
      return {
        id: nextWebContentsId++,
        session: { partition: 'workspace' },
        isDestroyed: () => false,
        setAudioMuted: () => undefined,
        getURL: () => committed,
        isLoading: () => loading,
        loadURL: (next: string) => {
          pages.loads.push(next)
          loading = true
          return Promise.resolve()
        },
        commit: (next: string) => {
          committed = next
          loading = false
        },
        navigationHistory: { restore: () => Promise.resolve() }
      }
    })()
    setBackgroundColor(): void {}
    setBounds(): void {}
  }
  return { session: {}, WebContentsView, nativeImage: {}, shell: {}, app: { getPath: () => '/tmp' }, powerMonitor: { on: () => undefined } }
})
import { BrowserTabsManager } from '../src/main/browser/tabs-manager.js'
import { nextPageLoadTurn } from '../src/main/browser/page-load-turns/page-load-turns.js'

const AGENT = '01912345-6789-7abc-8def-0123456789ab'

interface Tab { id: string; webContents: { loadURL(url: string): Promise<void>; commit(url: string): void } }

/** A browser with one open workspace whose tabs are created for real, with their views faked. */
function fixture() {
  const manager = Object.assign(Object.create(BrowserTabsManager.prototype), {
    destroyed: false,
    initialized: true,
    restoringLayout: false,
    options: { partition: 'persist:hronaut', configureSession: vi.fn() },
    window: {
      isDestroyed: () => false,
      isFocused: () => true,
      getContentBounds: () => ({ x: 0, y: 0, width: 1440, height: 900 }),
      webContents: { isDestroyed: () => false, getZoomFactor: () => 1 },
      contentView: { children: [], addChildView: vi.fn(), removeChildView: vi.fn() }
    },
    tabs: new Map(),
    mcpTabGroups: new Map([[AGENT, {
      id: AGENT, name: 'Client', description: '', color: 'blue', createdAt: '', lastUsedAt: '', activeTabId: null,
      storageId: '8e3da8ea-cba4-41c2-9619-a6e04a493a44', origins: [], navigationPolicy: { mode: 'open', rules: [] },
      navigationAudit: [], contextClass: 'standard', deletionProtected: false
    }]]),
    workspaceOperations: new Map(),
    webContentsToTab: new Map(),
    openedTabObservations: new Map(),
    activeTabId: 'existing',
    splitView: null,
    tabSelectionGeneration: 0,
    toolbarHeight: 60,
    contentInsets: { top: 0, right: 10, bottom: 10, left: 280 },
    allTabsMuted: false,
    assertWorkspaceNavigationAllowed: vi.fn(),
    workspaceNavigationAllowed: () => true,
    workspaceObservationGeneration: () => 0,
    roundPageCorners: vi.fn(),
    installSessionHooks: vi.fn(),
    attachTabEvents: vi.fn(),
    layout: vi.fn(),
    changed: vi.fn(),
    getState: () => ({})
  }) as BrowserTabsManager
  const browser = manager as unknown as { tabs: Map<string, Tab>; createTab(options: Record<string, unknown>): Promise<Tab> }
  return { tabs: browser.tabs, createTab: (options: Record<string, unknown>) => browser.createTab(options) }
}

it('starts the loads of tabs opened together one per turn, in the order they were opened', async () => {
  pages.loads.length = 0
  const { createTab } = fixture()
  await Promise.all(['https://one.test/', 'https://two.test/', 'https://three.test/'].map((url) => (
    createTab({ url, mcpGroupId: AGENT, active: false })
  )))
  // No load has started in the task that opened them.
  expect(pages.loads).toEqual([])
  await nextPageLoadTurn()
  expect(pages.loads).toEqual(['https://one.test/', 'https://two.test/', 'https://three.test/'])
})

it('keeps a navigation still loading from before the tab’s turn instead of loading the address it opened with', async () => {
  // An agent can open a tab and send it elsewhere before its turn; that load has committed no address yet.
  pages.loads.length = 0
  const { createTab } = fixture()
  const tab = await createTab({ url: 'https://opened.test/', mcpGroupId: AGENT, active: false })
  void tab.webContents.loadURL('https://newer.test/')
  await nextPageLoadTurn()
  expect(pages.loads).toEqual(['https://newer.test/'])
})

it('keeps a page that already loaded before the tab’s turn', async () => {
  pages.loads.length = 0
  const { createTab } = fixture()
  const tab = await createTab({ url: 'https://opened.test/', mcpGroupId: AGENT, active: false })
  void tab.webContents.loadURL('https://newer.test/')
  tab.webContents.commit('https://newer.test/')
  await nextPageLoadTurn()
  expect(pages.loads).toEqual(['https://newer.test/'])
})

it('loads nothing into a tab closed before its turn', async () => {
  pages.loads.length = 0
  const { tabs, createTab } = fixture()
  const closed = await createTab({ url: 'https://closed.test/', mcpGroupId: AGENT, active: false })
  await createTab({ url: 'https://kept.test/', mcpGroupId: AGENT, active: false })
  tabs.delete(closed.id)
  await nextPageLoadTurn()
  expect(pages.loads).toEqual(['https://kept.test/'])
})
