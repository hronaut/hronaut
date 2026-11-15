import { describe, expect, it, vi } from 'vitest'

// The state the snapshot sends, named after the tab runtime it was built from, without a real runtime behind it.
vi.mock('../src/main/browser/browser-state/browser-state.js', () => ({ browserState: (browser: { name: string }) => ({ of: browser.name }) }))

const { createMainWindowSnapshot } = await import('../src/main/windows/main-window-snapshot.js')

const tabs = { name: 'tab runtime' }

/** A snapshot with the tab runtime the test gives it, and a main window that records what its page is sent. */
function snapshotWith(tabRuntime: { tabs: unknown; initialization: Promise<void> | null }, pageDestroyed = false) {
  const sent: unknown[][] = []
  const window = { webContents: { isDestroyed: () => pageDestroyed, send: (...message: unknown[]) => { sent.push(message) } } }
  const snapshot = createMainWindowSnapshot({
    tabRuntime: tabRuntime as never,
    settings: () => ({ theme: 'dark' }) as never,
    currentRendererSettingsState: () => ({ interfaceScale: 1 }) as never,
    updateState: () => ({ status: 'idle' }) as never,
    currentMcpControlState: () => ({ status: 'running' }) as never,
    credentialStore: () => ({ list: () => [{ id: 'credential-1' }] }) as never,
    bookmarkStore: () => ({ list: () => [{ id: 'bookmark-1' }] }) as never,
    historyStore: () => ({ list: () => [{ id: 'visit-1' }] }) as never
  })
  return { snapshot, sent, window: window as never }
}

describe('the main window snapshot', () => {
  it('sends a loaded page the tabs\' state, updates, MCP, bookmarks and history', () => {
    const { snapshot, sent, window } = snapshotWith({ tabs, initialization: null })
    snapshot.sendPageLoadedSnapshot(window)
    expect(sent).toEqual([
      ['browser:state-changed', { of: 'tab runtime' }],
      ['updates:changed', { status: 'idle' }],
      ['mcp:changed', { status: 'running' }],
      ['bookmarks:changed', [{ id: 'bookmark-1' }]],
      ['visit-history:changed', [{ id: 'visit-1' }]]
    ])
  })

  it('leaves the state out of a page loaded while saved workspaces are restored', () => {
    const { snapshot, sent, window } = snapshotWith({ tabs, initialization: new Promise<void>(() => undefined) })
    snapshot.sendPageLoadedSnapshot(window)
    expect(sent.map(([channel]) => channel)).toEqual(['updates:changed', 'mcp:changed', 'bookmarks:changed', 'visit-history:changed'])
  })

  it('sends a loaded page nothing before the tabs exist, without a window or once its page is gone', () => {
    const before = snapshotWith({ tabs: null, initialization: null })
    before.snapshot.sendPageLoadedSnapshot(before.window)
    before.snapshot.sendPageLoadedSnapshot(null)
    const gone = snapshotWith({ tabs, initialization: null }, true)
    gone.snapshot.sendPageLoadedSnapshot(gone.window)
    expect([...before.sent, ...gone.sent]).toEqual([])
  })

  it('sends the state, settings, updates, MCP, saved sign-ins, bookmarks and history once saved workspaces are restored', () => {
    const { snapshot, sent, window } = snapshotWith({ tabs, initialization: null })
    snapshot.sendWorkspacesRestoredSnapshot(window)
    expect(sent).toEqual([
      ['browser:state-changed', { of: 'tab runtime' }],
      ['settings:changed', { theme: 'dark' }],
      ['settings:renderer-state-changed', { interfaceScale: 1 }],
      ['updates:changed', { status: 'idle' }],
      ['mcp:changed', { status: 'running' }],
      ['credentials:changed', [{ id: 'credential-1' }]],
      ['bookmarks:changed', [{ id: 'bookmark-1' }]],
      ['visit-history:changed', [{ id: 'visit-1' }]]
    ])
  })

  it('sends nothing once the restore ends if the shell\'s page is gone', () => {
    const { snapshot, sent, window } = snapshotWith({ tabs: null, initialization: null }, true)
    snapshot.sendWorkspacesRestoredSnapshot(window)
    expect(sent).toEqual([])
  })

  it('ends the startup once the restore ends if the window or the tabs went away, as quitting during it does', () => {
    const closed = snapshotWith({ tabs, initialization: null })
    expect(() => closed.snapshot.sendWorkspacesRestoredSnapshot(null)).toThrow('The main window closed while saved workspaces were restored')
    const released = snapshotWith({ tabs: null, initialization: null })
    expect(() => released.snapshot.sendWorkspacesRestoredSnapshot(released.window)).toThrow('The tabs were released while saved workspaces were restored')
    expect([...closed.sent, ...released.sent]).toEqual([])
  })
})
