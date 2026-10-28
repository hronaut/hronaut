import { expect, it, vi } from 'vitest'

const pages = vi.hoisted(() => ({ loads: [] as string[] }))

vi.mock('electron', () => {
  let nextWebContentsId = 100
  class WebContentsView {
    webContents = (() => {
      let url = ''
      return {
        id: nextWebContentsId++,
        session: { partition: 'workspace' },
        isDestroyed: () => false,
        setAudioMuted: () => undefined,
        getURL: () => url,
        isLoading: () => url !== '',
        loadURL: (next: string) => {
          pages.loads.push(next)
          url = next
          return Promise.resolve()
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
import { nextPageLoadTurn } from '../src/main/browser/new-tabs/page-load-turns.js'

const AGENT = '01912345-6789-7abc-8def-0123456789ab'

interface Tab { webContents: { loadURL(url: string): Promise<void> } }

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
  return (options: Record<string, unknown>) => (
    manager as unknown as { createTab(options: Record<string, unknown>): Promise<Tab> }
  ).createTab(options)
}

it('starts the loads of tabs opened together one per turn, in the order they were opened', async () => {
  pages.loads.length = 0
  const createTab = fixture()
  await Promise.all(['https://one.test/', 'https://two.test/', 'https://three.test/'].map((url) => (
    createTab({ url, mcpGroupId: AGENT, active: false })
  )))
  // No load has started in the task that opened them.
  expect(pages.loads).toEqual([])
  await nextPageLoadTurn()
  expect(pages.loads).toEqual(['https://one.test/', 'https://two.test/', 'https://three.test/'])
})

it('keeps a navigation that began before the tab’s turn instead of loading the address it opened with', async () => {
  // An agent can open a tab and send it elsewhere before its first load started; the older address must not win.
  pages.loads.length = 0
  const createTab = fixture()
  const tab = await createTab({ url: 'https://opened.test/', mcpGroupId: AGENT, active: false })
  void tab.webContents.loadURL('https://newer.test/')
  await nextPageLoadTurn()
  expect(pages.loads).toEqual(['https://newer.test/'])
})
