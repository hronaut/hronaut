import { describe, expect, it, vi } from 'vitest'
import { navigate } from '../src/main/browser/page-navigation/page-navigation.js'

// The browser below stubs getState and assertWorkspaceNavigationAllowed, which navigating publishes through and checks
// the workspace's sites with.
vi.mock('../src/main/browser/browser-state/browser-state.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/main/browser/browser-state/browser-state.js')>(),
  browserState: (browser: { getState: () => unknown }) => browser.getState()
}))
vi.mock('../src/main/browser/workspace-navigation/workspace-navigation.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/main/browser/workspace-navigation/workspace-navigation.js')>(),
  assertWorkspaceNavigationAllowed: (browser: { assertWorkspaceNavigationAllowed: () => void }) => browser.assertWorkspaceNavigationAllowed()
}))

// A tab sent to another address kept which page opened which tab of its workspace, where Chrome forgets it, so closing
// a tab opened before then still showed the page's other tabs.

interface FakeTab { id: string; url: string; pinned: boolean; mcpGroupId: string | undefined; openedFromTabId?: string; returnsToTabId?: string }

interface FakePage {
  url: string
  entries: number
  last?: boolean
  /** The address the tab stands for, when it has not loaded it yet, as a tab restored asleep. */
  address?: string
}

function navigation(mcpGroupId: string | undefined, allowed = true, page: FakePage = { url: 'https://page.example/', entries: 2 }) {
  const loadURL = vi.fn(async () => undefined)
  let shown = page
  const tab: FakeTab & Record<string, unknown> = {
    id: 'tab', url: page.address ?? (page.url || 'about:blank'), pinned: false, mcpGroupId, navigationGeneration: 0, navigationPolicyDenialSequence: 0,
    sleeping: false, returnsToTabId: 'before',
    webContents: {
      on: vi.fn(), once: vi.fn(), removeListener: vi.fn(), isCrashed: () => false, isDestroyed: () => false, loadURL,
      getURL: () => shown.url, navigationHistory: { length: () => shown.entries }
    }
  }
  // A tab of the same workspace that the tab's page opened, and the tab a new tab was opened from.
  const opened: FakeTab = { id: 'opened', url: 'https://opened.example/', pinned: false, mcpGroupId, openedFromTabId: 'tab' }
  const before: FakeTab = { id: 'before', url: 'https://before.example/', pinned: false, mcpGroupId }
  const order = page.last ? [before, opened, tab] : [before, tab, opened]
  const browser = {
    tabs: new Map<string, object>(order.map((candidate) => [candidate.id, candidate])),
    mcpTabGroups: new Map(mcpGroupId ? [[mcpGroupId, { id: mcpGroupId }]] : []),
    activeTabId: tab.id,
    options: {},
    assertWorkspaceNavigationAllowed: () => { if (!allowed) throw new Error('The workspace does not allow this site') },
    prepareDiagnosticNavigation: vi.fn(),
    getState: () => ({})
  }
  return {
    // An address the person typed or chose, as the address field sends it.
    go: (options: { byPerson?: boolean; typed?: boolean } = { byPerson: true, typed: true }) => (
      navigate(browser as never, 'https://next.example/', undefined, options)
    ),
    // The tab now shows the address it went to.
    moved: () => { shown = { url: 'https://next.example/', entries: 2 } },
    loadURL, opened, tab
  }
}

describe('sending a tab to another address', () => {
  it('forgets which page opened which tab of its workspace', async () => {
    const { go, loadURL, opened } = navigation('work')
    await go()
    expect(opened.openedFromTabId).toBeUndefined()
    expect(loadURL).toHaveBeenCalledWith('https://next.example/')
  })

  // A new tab sent to a second address, or a duplicated tab sent to another, still went back to the tab it was opened
  // from when it closed, where Chrome shows the tab beside it: it forgets that on a typed address too.
  it('forgets which tab a new tab goes back to when it closes', async () => {
    const { go, tab } = navigation('work')
    await go()
    expect(tab.returnsToTabId).toBeUndefined()
  })

  // Chrome keeps it for a link dropped on the tab and for the certificate page's Proceed, which reloads.
  it('keeps which tab a new tab goes back to for an address the person did not type or choose', async () => {
    for (const options of [{ byPerson: true }, {}]) {
      const { go, opened, tab } = navigation('work')
      await go(options)
      expect(tab.returnsToTabId).toBe('before')
      expect(opened.openedFromTabId).toBeUndefined()
    }
  })

  it('does not take a tab restored asleep at the end of its workspace for a new tab', async () => {
    const { go, opened, tab } = navigation('work', true, { url: '', entries: 0, last: true, address: 'https://restored.example/' })
    await go()
    expect(tab.returnsToTabId).toBeUndefined()
    expect(opened.openedFromTabId).toBeUndefined()
  })

  it('lets a new tab at the end of its workspace go to one address first, as Chrome does for a quick look-up', async () => {
    for (const url of ['about:blank', '']) {
      const { go, moved, tab, opened } = navigation('work', true, { url, entries: url ? 1 : 0, last: true })
      await go()
      expect(tab.returnsToTabId).toBe('before')
      expect(opened.openedFromTabId).toBe('tab')
      moved()
      await go()
      expect(tab.returnsToTabId).toBeUndefined()
      expect(opened.openedFromTabId).toBeUndefined()
    }
  })

  it('does not for a new tab with a tab after it in its workspace', async () => {
    const { go, tab } = navigation('work', true, { url: 'about:blank', entries: 1 })
    await go()
    expect(tab.returnsToTabId).toBeUndefined()
  })

  it('keeps it when the workspace does not allow the address, as nothing changes', async () => {
    const { go, loadURL, opened, tab } = navigation('work', false)
    await expect(go()).rejects.toThrow('The workspace does not allow this site')
    expect(opened.openedFromTabId).toBe('tab')
    expect(tab.returnsToTabId).toBe('before')
    expect(loadURL).not.toHaveBeenCalled()
  })

  it('has nothing to forget for a tab outside a workspace', async () => {
    const { go, opened } = navigation(undefined)
    await go()
    expect(opened.openedFromTabId).toBe('tab')
  })
})
