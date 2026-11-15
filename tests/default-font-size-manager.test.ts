import { expect, it, vi } from 'vitest'
vi.mock('electron', () => ({ session: {}, WebContentsView: class {}, nativeImage: {}, shell: {}, app: { getPath: () => '/tmp' } }))
// The prototype-built browser below stubs getState, reorderTab, ensureHumanWorkspace and
// assertWorkspaceNavigationAllowed; opening and duplicating a tab reach them through these.
vi.mock('../src/main/browser/browser-state/browser-state.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/main/browser/browser-state/browser-state.js')>(),
  browserState: (browser: { getState: () => unknown }) => browser.getState()
}))
vi.mock('../src/main/browser/tab-arrangement/tab-arrangement.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/main/browser/tab-arrangement/tab-arrangement.js')>(),
  reorderTab: (
    browser: { reorderTab: (tabId: string, targetTabId: string, placement: 'before' | 'after') => unknown },
    tabId: string,
    targetTabId: string,
    placement: 'before' | 'after'
  ) => browser.reorderTab(tabId, targetTabId, placement)
}))
vi.mock('../src/main/browser/workspace-creation/human-workspace.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/main/browser/workspace-creation/human-workspace.js')>(),
  ensureHumanWorkspace: (browser: { ensureHumanWorkspace: () => string }) => browser.ensureHumanWorkspace()
}))
vi.mock('../src/main/browser/workspace-navigation/workspace-navigation.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/main/browser/workspace-navigation/workspace-navigation.js')>(),
  assertWorkspaceNavigationAllowed: (browser: { assertWorkspaceNavigationAllowed: (...args: unknown[]) => unknown }, ...args: unknown[]) => browser.assertWorkspaceNavigationAllowed(...args)
}))
import { Browser } from '../src/main/browser/browser.js'
import { duplicateTabAfterLabelSave } from '../src/main/browser/tab-reopening/tab-reopening.js'
import { newTab } from '../src/main/browser/new-tabs/open-new-tab.js'

// The fake browser below stubs the functions the code under test calls; these reach its stubs.
vi.mock('../src/main/browser/mcp-tab-groups/mcp-tab-groups.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/main/browser/mcp-tab-groups/mcp-tab-groups.js')>(),
  requireMcpTabGroup: (browser: { requireMcpTabGroup: (...args: unknown[]) => unknown }, ...args: unknown[]) => browser.requireMcpTabGroup(...args)
}))

function fixture() {
  const source = { id: 'source', title: 'Page', url: 'https://example.test/', label: undefined, pinned: false, mcpGroupId: 'workspace', zoomIsolated: false, defaultFontSize: 32 }
  const createTab = vi.fn(async (options: Record<string, unknown>) => ({ ...source, ...options, id: 'created' }))
  const ensureHumanWorkspace = vi.fn(() => 'workspace')
  const manager = Object.assign(Object.create(Browser.prototype), {
    tabs: new Map([[source.id, source]]), mcpTabGroups: new Map([['workspace', {}]]), options: {},
    createTab, ensureHumanWorkspace, requireMcpTabGroup: vi.fn(), assertWorkspaceNavigationAllowed: vi.fn(),
    navigationHistorySnapshot: () => undefined, reorderTab: vi.fn(), getState: () => ({ tabs: [source] })
  }) as Browser
  return { manager, createTab, ensureHumanWorkspace }
}

for (const value of [8, 73, 24.5, Number.NaN]) {
  it(`rejects defaultFontSize ${value} before creating a tab or workspace`, async () => {
    const f = fixture()
    await expect(newTab(f.manager, { url: 'https://example.test/', defaultFontSize: value })).rejects.toThrow('defaultFontSize must be an integer from 9 to 72 CSS pixels')
    expect(f.createTab).not.toHaveBeenCalled()
    expect(f.ensureHumanWorkspace).not.toHaveBeenCalled()
  })
}

it('passes a valid defaultFontSize to tab construction', async () => {
  const f = fixture()
  await newTab(f.manager, { url: 'https://example.test/', defaultFontSize: 32 })
  expect(f.createTab).toHaveBeenCalledOnce()
  expect(f.createTab.mock.calls[0]?.[0]).toMatchObject({ url: 'https://example.test/', defaultFontSize: 32, zoomIsolated: false })
})

it('carries the source defaultFontSize into a duplicate', async () => {
  const f = fixture()
  await duplicateTabAfterLabelSave(f.manager, 'source')
  expect(f.createTab.mock.calls[0]?.[0]).toMatchObject({ url: 'https://example.test/', defaultFontSize: 32 })
})
