import { describe, expect, it, vi } from 'vitest'
import { navigate } from '../src/main/browser/page-navigation/page-navigation.js'

// A tab sent to another address kept which page opened which tab of its workspace, where Chrome forgets it, so closing
// a tab opened before then still showed the page's other tabs.

function navigation(mcpGroupId: string | undefined, allowed = true) {
  const loadURL = vi.fn(async () => undefined)
  const forgetTabsOpenedFrom = vi.fn()
  const tab = {
    id: 'tab', mcpGroupId, navigationGeneration: 0, navigationPolicyDenialSequence: 0, sleeping: false,
    webContents: { on: vi.fn(), once: vi.fn(), removeListener: vi.fn(), isCrashed: () => false, loadURL }
  }
  const access = {
    getTab: () => tab,
    findTab: () => tab,
    searchEngine: () => undefined,
    assertWorkspaceNavigationAllowed: () => { if (!allowed) throw new Error('The workspace does not allow this site') },
    prepareDiagnosticNavigation: vi.fn(),
    forgetTabsOpenedFrom,
    getState: () => ({})
  }
  return { go: () => navigate(access as never, 'https://next.example/'), loadURL, forgetTabsOpenedFrom }
}

describe('sending a tab to another address', () => {
  it('forgets which page opened which tab of its workspace', async () => {
    const { go, loadURL, forgetTabsOpenedFrom } = navigation('work')
    await go()
    expect(forgetTabsOpenedFrom).toHaveBeenCalledWith('work')
    expect(loadURL).toHaveBeenCalledWith('https://next.example/')
  })

  it('keeps it when the workspace does not allow the address, as nothing changes', async () => {
    const { go, loadURL, forgetTabsOpenedFrom } = navigation('work', false)
    await expect(go()).rejects.toThrow('The workspace does not allow this site')
    expect(forgetTabsOpenedFrom).not.toHaveBeenCalled()
    expect(loadURL).not.toHaveBeenCalled()
  })

  it('has nothing to forget for a tab outside a workspace', async () => {
    const { go, forgetTabsOpenedFrom } = navigation(undefined)
    await go()
    expect(forgetTabsOpenedFrom).not.toHaveBeenCalled()
  })
})
