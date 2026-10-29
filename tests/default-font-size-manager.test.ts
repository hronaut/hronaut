import { expect, it, vi } from 'vitest'
vi.mock('electron', () => ({ session: {}, WebContentsView: class {}, nativeImage: {}, shell: {}, app: { getPath: () => '/tmp' } }))
import { Browser } from '../src/main/browser/browser.js'

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
    await expect(f.manager.newTab({ url: 'https://example.test/', defaultFontSize: value })).rejects.toThrow('defaultFontSize must be an integer from 9 to 72 CSS pixels')
    expect(f.createTab).not.toHaveBeenCalled()
    expect(f.ensureHumanWorkspace).not.toHaveBeenCalled()
  })
}

it('passes a valid defaultFontSize to tab construction', async () => {
  const f = fixture()
  await f.manager.newTab({ url: 'https://example.test/', defaultFontSize: 32 })
  expect(f.createTab).toHaveBeenCalledOnce()
  expect(f.createTab.mock.calls[0]?.[0]).toMatchObject({ url: 'https://example.test/', defaultFontSize: 32, zoomIsolated: false })
})

it('carries the source defaultFontSize into a duplicate', async () => {
  const f = fixture()
  await (f.manager as unknown as { duplicateTabAfterLabelSave(id: string): Promise<unknown> }).duplicateTabAfterLabelSave('source')
  expect(f.createTab.mock.calls[0]?.[0]).toMatchObject({ url: 'https://example.test/', defaultFontSize: 32 })
})
