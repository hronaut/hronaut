import { describe, expect, it, vi } from 'vitest'
import type { BrowserClosedTabState } from '../src/shared/types.js'
import { WorkspaceRegistry, type ActiveWorkspace } from '../src/main/browser/workspace-registry.js'
import type { UndoableAction } from '../src/main/undo-offers.js'

vi.mock('electron', () => ({ session: {}, WebContentsView: class {}, nativeImage: {}, shell: {}, app: { getPath: () => '/tmp' }, Menu: {} }))
// The browser below stubs changed and getState, which archiving and closing a workspace publish and return through these.
vi.mock('../src/main/browser/browser-state/browser-state.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/main/browser/browser-state/browser-state.js')>(),
  publishChange: (browser: { changed: (persist?: boolean) => void }, persist?: boolean) => browser.changed(persist),
  browserState: (browser: { getState: () => unknown }) => browser.getState()
}))
const { archiveWorkspaceForPerson, closeWorkspaceForPerson } = await import('../src/main/browser/workspace-archive/workspace-archive.js')

// Undo of closing or archiving a workspace brought it back at the bottom of the tab rail, unpinned, on its last tab,
// with its tabs' isolated zoom and font size gone and without the tabs the person had closed in it.

interface Tab { id: string; mcpGroupId?: string; title: string; url: string; pinned: boolean; label?: string; zoomIsolated?: boolean; defaultFontSize?: number }

function workspace(id: string, pinnedAt?: string): ActiveWorkspace {
  return { id, name: id, description: '', color: 'blue', createdAt: '2026-10-21T09:00:00.000Z', lastUsedAt: '2026-10-21T09:00:00.000Z',
    activeTabId: null, storageId: `storage-${id}`, origins: [], navigationPolicy: { mode: 'unrestricted', rules: [] }, navigationAudit: [],
    contextClass: 'standard', ...(pinnedAt ? { pinnedAt } : {}) }
}

function closedTab(id: string, mcpGroupId: string, closedAt: string): BrowserClosedTabState {
  return { id, title: id, url: `https://${id}.example/`, pinned: false, closedAt, mcpGroupId }
}

/**
 * Three open workspaces, the middle one pinned with two tabs, the first of which is shown and zoomed on its own. Its
 * close can fail as closing its tabs does when one cannot close, which reopens them and forgets its closed tabs.
 */
function browser(options: { closeFails?: boolean } = {}) {
  const tabs: Tab[] = [
    { id: 'a', mcpGroupId: 'two', title: 'A', url: 'https://a.example/', pinned: false, zoomIsolated: true, defaultFontSize: 20 },
    { id: 'b', mcpGroupId: 'two', title: 'B', url: 'https://b.example/', pinned: false }
  ]
  let created = 0
  const selected: string[] = []
  const registry: WorkspaceRegistry = new WorkspaceRegistry({
    maxTabs: 50,
    maxArchived: 50,
    tabs: () => tabs,
    requireActive: (id) => {
      if (!registry.active.has(id)) throw new Error(`Unknown workspace: ${id}.`)
      return { id } as never
    },
    assertRestoreCapacity: () => undefined,
    withActiveOperation: (_id, _action, run) => run(),
    withArchivedOperation: (_id, _action, run) => run(),
    closeActive: async (id) => {
      if (options.closeFails) {
        closedTabs.splice(0, closedTabs.length, ...closedTabs.filter((tab) => tab.mcpGroupId !== id))
        throw new Error('A tab could not close.')
      }
      tabs.splice(0, tabs.length, ...tabs.filter((tab) => tab.mcpGroupId !== id))
      registry.active.delete(id)
    },
    createTab: vi.fn(async (tab) => { tabs.push({ ...tab, id: `restored-${++created}` }) }),
    selectTab: (id) => { selected.push(id) },
    remapDownloads: () => undefined,
    changed: () => undefined
  })
  registry.active.set('one', workspace('one'))
  registry.active.set('two', { ...workspace('two', '2026-10-21T09:30:00.000Z'), activeTabId: 'a' })
  registry.active.set('three', workspace('three'))
  const closedTabs: BrowserClosedTabState[] = [
    closedTab('older-two', 'two', '2026-10-21T10:00:00.000Z'),
    closedTab('one-closed', 'one', '2026-10-21T10:01:00.000Z'),
    closedTab('newer-two', 'two', '2026-10-21T10:02:00.000Z')
  ]
  const detachedClosedTabs = new Set<BrowserClosedTabState[]>()
  const offers: UndoableAction[] = []
  const tabManager = {
    mcpTabGroups: registry.active,
    savedTabGroups: registry.archived,
    savedWorkspaceOperations: new Map(),
    closingWorkspace: undefined,
    options: { partition: 'persist:test', offerUndo: (offer: UndoableAction) => { offers.push(offer) }, endUndo: async () => undefined },
    closedTabs,
    detachedClosedTabs,
    workspaceRegistry: registry,
    tabLabelLifecycleHolds: 0,
    pendingTabLabels: new Set(),
    changed: () => undefined,
    getState: () => ({})
  }
  // As closing the workspace does, its closed tabs leave the list.
  const forgetWorkspaceClosedTabs = () => closedTabs.splice(0, closedTabs.length, ...closedTabs.filter((tab) => tab.mcpGroupId !== 'two'))
  return { registry, tabs, selected, closedTabs, detachedClosedTabs, offers, tabManager, forgetWorkspaceClosedTabs }
}

describe('restoring an archived workspace', () => {
  it('opens its tabs with their isolated zoom and font size, and shows the tab that was shown', async () => {
    const { registry, tabs, selected } = browser()
    await registry.archive('two')
    expect(registry.archived.get('two')).toMatchObject({
      shownTabIndex: 0,
      tabs: [{ url: 'https://a.example/', zoomIsolated: true, defaultFontSize: 20 }, { url: 'https://b.example/' }]
    })
    // The browser state still publishes only what it did.
    expect(registry.publicArchive(registry.archived.get('two')!).tabs).toEqual([
      { title: 'A', url: 'https://a.example/', pinned: false }, { title: 'B', url: 'https://b.example/', pinned: false }
    ])

    await registry.restore('two')

    expect(tabs).toEqual([
      expect.objectContaining({ id: 'restored-1', url: 'https://a.example/', zoomIsolated: true, defaultFontSize: 20 }),
      expect.objectContaining({ id: 'restored-2', url: 'https://b.example/', zoomIsolated: false, defaultFontSize: undefined })
    ])
    expect(selected).toEqual(['restored-1'])
    // Restored from the archive list, it goes to the end of the tab rail, unpinned.
    expect([...registry.active.keys()]).toEqual(['one', 'three', 'two'])
    expect(registry.active.get('two')!.pinnedAt).toBeUndefined()
  })
})

describe('Undo of archiving or closing a workspace', () => {
  it.each([
    ['archiving', (tabManager: never) => archiveWorkspaceForPerson(tabManager, 'two')],
    ['closing', (tabManager: never) => closeWorkspaceForPerson(tabManager, 'two')]
  ])('brings it back where it was after %s it, pinned, with the tabs closed in it', async (_name, close) => {
    const { registry, selected, closedTabs, offers, tabManager, forgetWorkspaceClosedTabs } = browser()
    await close(tabManager as never)
    forgetWorkspaceClosedTabs()
    expect(closedTabs.map((tab) => tab.id)).toEqual(['one-closed'])

    await expect(offers[0]!.undo()).resolves.toBe(true)

    expect([...registry.active.keys()]).toEqual(['one', 'two', 'three'])
    expect(registry.active.get('two')!.pinnedAt).toBe('2026-10-21T09:30:00.000Z')
    expect(selected).toEqual(['restored-1'])
    expect(closedTabs.map((tab) => tab.id)).toEqual(['older-two', 'one-closed', 'newer-two'])
  })

  it('brings it back next to the workspace it followed when one before that closed meanwhile', async () => {
    const { registry, offers, tabManager, forgetWorkspaceClosedTabs } = browser()
    await archiveWorkspaceForPerson(tabManager as never, 'two')
    forgetWorkspaceClosedTabs()
    // An agent closes the workspace before it, which ends no Undo.
    registry.active.delete('one')

    await offers[0]!.undo()

    // Its old place, the second, would now be after the workspace it came before.
    expect([...registry.active.keys()]).toEqual(['two', 'three'])
  })

  it.each(['undo', 'finalize'] as const)('puts the closed tabs back on %s when it was restored from the archive meanwhile', async (end) => {
    const { registry, closedTabs, detachedClosedTabs, offers, tabManager, forgetWorkspaceClosedTabs } = browser()
    await archiveWorkspaceForPerson(tabManager as never, 'two')
    forgetWorkspaceClosedTabs()
    await registry.restore('two')

    if (end === 'undo') await expect(offers[0]!.undo()).resolves.toBe(false)
    else await offers[0]!.finalize!()

    expect(closedTabs.map((tab) => tab.id)).toEqual(['older-two', 'one-closed', 'newer-two'])
    expect(detachedClosedTabs.size).toBe(0)
  })

  it.each([
    ['archiving', (tabManager: never) => archiveWorkspaceForPerson(tabManager, 'two')],
    ['closing', (tabManager: never) => closeWorkspaceForPerson(tabManager, 'two')]
  ])('keeps the closed tabs when %s it fails and it stays open', async (_name, close) => {
    const { registry, closedTabs, detachedClosedTabs, offers, tabManager } = browser({ closeFails: true })

    await expect(close(tabManager as never)).rejects.toThrow('A tab could not close.')

    expect(registry.active.has('two')).toBe(true)
    expect(offers).toEqual([])
    expect(closedTabs.map((tab) => tab.id)).toEqual(['older-two', 'one-closed', 'newer-two'])
    expect(detachedClosedTabs.size).toBe(0)
  })

  it('keeps forgotten the closed tabs whose history was cleared while Undo was on offer', async () => {
    const { closedTabs, detachedClosedTabs, offers, tabManager, forgetWorkspaceClosedTabs } = browser()
    await archiveWorkspaceForPerson(tabManager as never, 'two')
    forgetWorkspaceClosedTabs()
    // Clearing the history reaches the closed tabs held aside for Undo.
    for (const held of detachedClosedTabs) held.splice(held.findIndex((tab) => tab.id === 'newer-two'), 1)

    await offers[0]!.undo()

    expect(closedTabs.map((tab) => tab.id)).toEqual(['older-two', 'one-closed'])
    expect(detachedClosedTabs.size).toBe(0)
  })

  it('lets go of the held closed tabs once Undo is no longer offered', async () => {
    const { detachedClosedTabs, offers, tabManager } = browser()
    await archiveWorkspaceForPerson(tabManager as never, 'two')
    expect(detachedClosedTabs.size).toBe(1)

    await offers[0]!.finalize!()

    expect(detachedClosedTabs.size).toBe(0)
  })
})
