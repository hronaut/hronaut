import { describe, expect, it, vi } from 'vitest'

// The state the snapshot sends, without a real tab runtime behind it.
vi.mock('../src/main/browser/browser-state/browser-state.js', () => ({ browserState: () => ({ tabs: [], activeTabId: null }) }))

const { createMainWindowSnapshot } = await import('../src/main/windows/main-window-snapshot.js')

/** A snapshot over a main window that records what it is sent, with the tab runtime the test gives it. */
function snapshotWith(tabRuntime: { tabs: unknown; initialization: Promise<void> | null }) {
  const sent: unknown[][] = []
  const snapshot = createMainWindowSnapshot({
    sendToMainWindow: (channel, ...args) => { sent.push([channel, ...args]) },
    tabRuntime: tabRuntime as never,
    settings: () => ({ theme: 'dark' }) as never,
    currentRendererSettingsState: () => ({ interfaceScale: 1 }) as never,
    updateState: () => ({ status: 'idle' }) as never,
    currentMcpControlState: () => ({ status: 'running' }) as never,
    credentialStore: () => ({ list: () => [{ id: 'credential-1' }] }) as never,
    bookmarkStore: () => ({ list: () => [{ id: 'bookmark-1' }] }) as never,
    historyStore: () => null
  })
  return { snapshot, sent }
}

const state = { tabs: [], activeTabId: null }

describe('the main window snapshot', () => {
  it('sends a loaded page the tabs\' state, updates, MCP, bookmarks and history', () => {
    const { snapshot, sent } = snapshotWith({ tabs: {}, initialization: null })
    snapshot.sendPageLoadedSnapshot()
    expect(sent).toEqual([
      ['browser:state-changed', state],
      ['updates:changed', { status: 'idle' }],
      ['mcp:changed', { status: 'running' }],
      ['bookmarks:changed', [{ id: 'bookmark-1' }]],
      ['visit-history:changed', []]
    ])
  })

  it('leaves the state out of a page loaded while saved workspaces are restored', () => {
    const { snapshot, sent } = snapshotWith({ tabs: {}, initialization: new Promise<void>(() => undefined) })
    snapshot.sendPageLoadedSnapshot()
    expect(sent.map(([channel]) => channel)).toEqual(['updates:changed', 'mcp:changed', 'bookmarks:changed', 'visit-history:changed'])
  })

  it('sends a page loaded before the tabs exist nothing', () => {
    const { snapshot, sent } = snapshotWith({ tabs: null, initialization: null })
    snapshot.sendPageLoadedSnapshot()
    expect(sent).toEqual([])
  })

  it('sends the state, settings, updates, MCP, saved sign-ins, bookmarks and history once saved workspaces are restored', () => {
    const { snapshot, sent } = snapshotWith({ tabs: {}, initialization: null })
    snapshot.sendWorkspacesRestoredSnapshot()
    expect(sent).toEqual([
      ['browser:state-changed', state],
      ['settings:changed', { theme: 'dark' }],
      ['settings:renderer-state-changed', { interfaceScale: 1 }],
      ['updates:changed', { status: 'idle' }],
      ['mcp:changed', { status: 'running' }],
      ['credentials:changed', [{ id: 'credential-1' }]],
      ['bookmarks:changed', [{ id: 'bookmark-1' }]],
      ['visit-history:changed', []]
    ])
  })

  it('sends nothing once the restore ends if the tabs are gone', () => {
    const { snapshot, sent } = snapshotWith({ tabs: null, initialization: null })
    snapshot.sendWorkspacesRestoredSnapshot()
    expect(sent).toEqual([])
  })
})
