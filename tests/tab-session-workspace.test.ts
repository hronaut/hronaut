import { expect, it, vi } from 'vitest'
vi.mock('electron', () => {
  let nextWebContentsId = 100
  class WebContentsView {
    webContents = {
      id: nextWebContentsId++,
      session: { partition: 'workspace' },
      isDestroyed: () => false,
      setAudioMuted: () => undefined,
      isLoading: () => false,
      getURL: () => '',
      loadURL: () => Promise.resolve(),
      navigationHistory: { restore: () => Promise.resolve() }
    }
    setBackgroundColor(): void {}
    setBounds(): void {}
  }
  return { session: {}, WebContentsView, nativeImage: {}, shell: {}, app: { getPath: () => '/tmp' }, powerMonitor: { on: () => undefined } }
})
import { Browser } from '../src/main/browser/browser.js'

const AGENT = '01912345-6789-7abc-8def-0123456789ab'

/** A browser with one open workspace whose tabs are created for real, with their views faked. */
function fixture() {
  const configureSession = vi.fn()
  const manager = Object.assign(Object.create(Browser.prototype), {
    destroyed: false,
    initialized: true,
    restoringLayout: false,
    options: { partition: 'persist:hronaut', configureSession },
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
  }) as Browser
  const createTab = (options: Record<string, unknown>) => (
    manager as unknown as { createTab(options: Record<string, unknown>): Promise<unknown> }
  ).createTab(options)
  return { manager, configureSession, createTab }
}

it('names the workspace a tab belongs to when it prepares the tab’s browser session, and none for Home', async () => {
  // Site permission decisions belong to the workspace whose session a page runs in, so a session must know its
  // workspace; without one its pages get no permission.
  const { configureSession, createTab } = fixture()
  await createTab({ url: 'https://agent.test/', mcpGroupId: AGENT, active: false })
  expect(configureSession).toHaveBeenLastCalledWith({ partition: 'workspace' }, AGENT)
  await createTab({ url: 'hronaut://home/', active: false })
  expect(configureSession).toHaveBeenLastCalledWith({ partition: 'workspace' }, undefined)
})
