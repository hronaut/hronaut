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

function navigation(mcpGroupId: string | undefined, allowed = true) {
  const loadURL = vi.fn(async () => undefined)
  const tab = {
    id: 'tab', mcpGroupId, navigationGeneration: 0, navigationPolicyDenialSequence: 0, sleeping: false,
    webContents: { on: vi.fn(), once: vi.fn(), removeListener: vi.fn(), isCrashed: () => false, loadURL }
  }
  // A tab of the same workspace that the tab's page opened.
  const opened: { id: string; mcpGroupId: string | undefined; openedFromTabId?: string } = { id: 'opened', mcpGroupId, openedFromTabId: 'tab' }
  const browser = {
    tabs: new Map<string, object>([[tab.id, tab], [opened.id, opened]]),
    activeTabId: tab.id,
    options: {},
    assertWorkspaceNavigationAllowed: () => { if (!allowed) throw new Error('The workspace does not allow this site') },
    prepareDiagnosticNavigation: vi.fn(),
    getState: () => ({})
  }
  return { go: () => navigate(browser as never, 'https://next.example/'), loadURL, opened }
}

describe('sending a tab to another address', () => {
  it('forgets which page opened which tab of its workspace', async () => {
    const { go, loadURL, opened } = navigation('work')
    await go()
    expect(opened.openedFromTabId).toBeUndefined()
    expect(loadURL).toHaveBeenCalledWith('https://next.example/')
  })

  it('keeps it when the workspace does not allow the address, as nothing changes', async () => {
    const { go, loadURL, opened } = navigation('work', false)
    await expect(go()).rejects.toThrow('The workspace does not allow this site')
    expect(opened.openedFromTabId).toBe('tab')
    expect(loadURL).not.toHaveBeenCalled()
  })

  it('has nothing to forget for a tab outside a workspace', async () => {
    const { go, opened } = navigation(undefined)
    await go()
    expect(opened.openedFromTabId).toBe('tab')
  })
})
