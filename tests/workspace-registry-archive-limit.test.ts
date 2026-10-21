import { describe, expect, it, vi } from 'vitest'
import { WorkspaceRegistry, type ActiveWorkspace, type ArchivedWorkspace } from '../src/main/browser/workspace-registry.js'
import { MAX_ARCHIVED_WORKSPACES } from '../src/shared/undo.js'

vi.mock('electron', () => ({ session: {}, WebContentsView: class {}, nativeImage: {}, shell: {}, app: { getPath: () => '/tmp' }, Menu: {} }))
const { closeWorkspaceForPerson } = await import('../src/main/browser/workspace-archive/workspace-archive.js')

function deferred() {
  let resolve!: () => void
  let reject!: (error: Error) => void
  const promise = new Promise<void>((resolvePromise, rejectPromise) => { resolve = resolvePromise; reject = rejectPromise })
  return { promise, resolve, reject }
}

function activeWorkspace(id: string): ActiveWorkspace {
  const now = new Date().toISOString()
  return { id, name: `Workspace ${id}`, description: '', color: 'blue', createdAt: now, lastUsedAt: now, activeTabId: null,
    storageId: `storage-${id}`, origins: [], navigationPolicy: { mode: 'unrestricted', rules: [] }, navigationAudit: [], contextClass: 'standard' }
}

function archivedWorkspace(id: string, tabs: ArchivedWorkspace['tabs'] = []): ArchivedWorkspace {
  return { id, name: `Archive ${id}`, description: '', color: 'blue', savedAt: new Date().toISOString(), hiddenFromSidebar: false,
    deletionProtected: false, agentAccess: true, contextClass: 'standard', storageOriginCount: 0, storageId: `storage-${id}`,
    origins: [], navigationPolicy: { mode: 'unrestricted', rules: [] }, navigationAudit: [], tabs }
}

/**
 * A registry whose operations lock only their own workspace, as the tab manager's do, so operations on different
 * workspaces run at the same time. Closing and opening tabs wait until the test lets them finish.
 */
function harness(archivedCount: number) {
  const closing = new Map<string, ReturnType<typeof deferred>>()
  const opening = deferred()
  const busy = new Set<string>()
  const closeActive = vi.fn(async (id: string) => {
    const close = deferred()
    closing.set(id, close)
    await close.promise
    registry.active.delete(id)
  })
  const registry: WorkspaceRegistry = new WorkspaceRegistry({
    maxTabs: 50,
    maxArchived: MAX_ARCHIVED_WORKSPACES,
    tabs: () => [],
    requireActive: (id): never => {
      if (!registry.active.has(id)) throw new Error(`Unknown workspace: ${id}.`)
      return { id } as never
    },
    assertRestoreCapacity: () => undefined,
    withActiveOperation: async (id, _action, run) => {
      if (busy.has(id)) throw new Error('busy')
      busy.add(id)
      try { return await run() } finally { busy.delete(id) }
    },
    withArchivedOperation: async (_id, _action, run) => run(),
    closeActive,
    createTab: () => opening.promise,
    selectTab: () => undefined,
    remapDownloads: () => undefined,
    changed: () => undefined
  })
  for (let index = 0; index < archivedCount; index += 1) registry.archived.set(`archived-${index}`, archivedWorkspace(`archived-${index}`))
  const open = (id: string) => registry.active.set(id, activeWorkspace(id))
  const finishClosing = async (id: string) => {
    await vi.waitFor(() => expect(closing.has(id)).toBe(true))
    closing.get(id)!.resolve()
  }
  // Lets every close started so far finish, including ones that only a missing limit check lets start.
  const finishAllClosing = async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
    for (const close of closing.values()) close.resolve()
  }
  return { registry, closeActive, open, finishClosing, finishAllClosing, opening, busy }
}

describe('workspace archive limit', () => {
  it('lets only one of two archives started together take the last archive place', async () => {
    const { registry, closeActive, open, finishAllClosing } = harness(MAX_ARCHIVED_WORKSPACES - 1)
    open('a'); open('b')

    const results = Promise.allSettled([registry.archive('a'), registry.archive('b')])
    await finishAllClosing()
    const [first, second] = await results

    expect(registry.archived.size).toBe(MAX_ARCHIVED_WORKSPACES)
    expect(first.status).toBe('fulfilled')
    expect(second).toMatchObject({ status: 'rejected', reason: expect.objectContaining({ message: `Hronaut can keep up to ${MAX_ARCHIVED_WORKSPACES} archived workspaces.` }) })
    expect(registry.active.has('b')).toBe(true)
    expect(closeActive).toHaveBeenCalledExactlyOnceWith('a', true)
  })

  it('gives the place back when closing the workspace fails', async () => {
    const { registry, open, finishClosing, closeActive } = harness(MAX_ARCHIVED_WORKSPACES - 1)
    open('a'); open('b')
    closeActive.mockRejectedValueOnce(new Error('A tab would not close.'))

    await expect(registry.archive('a')).rejects.toThrow('A tab would not close.')
    const archived = registry.archive('b')
    await finishClosing('b')
    await archived
    expect(registry.archived.size).toBe(MAX_ARCHIVED_WORKSPACES)
  })

  it('keeps a restoring archive\'s place until its tabs are open, so a failed restore cannot go past the limit', async () => {
    const { registry, open, opening, finishAllClosing } = harness(MAX_ARCHIVED_WORKSPACES - 1)
    registry.archived.set('restoring', archivedWorkspace('restoring', [{ title: 'Page', url: 'https://example.test/', pinned: false }]))
    open('other')

    const restore = Promise.allSettled([registry.restore('restoring')])
    const archive = Promise.allSettled([registry.archive('other')])
    opening.reject(new Error('The tab limit is reached.'))
    await finishAllClosing()
    const [[restored], [archived]] = await Promise.all([restore, archive])

    expect(registry.archived.size).toBe(MAX_ARCHIVED_WORKSPACES)
    expect(registry.archived.has('restoring')).toBe(true)
    expect(restored).toMatchObject({ status: 'rejected', reason: expect.objectContaining({ message: 'The tab limit is reached.' }) })
    expect(archived).toMatchObject({ status: 'rejected', reason: expect.objectContaining({ message: `Hronaut can keep up to ${MAX_ARCHIVED_WORKSPACES} archived workspaces.` }) })
    expect(registry.active.has('other')).toBe(true)
  })

  it('gives the place back when a restore is refused before it starts opening tabs', async () => {
    const { registry, open, finishClosing, busy } = harness(MAX_ARCHIVED_WORKSPACES - 1)
    registry.archived.set('restoring', archivedWorkspace('restoring'))
    open('other')
    // Another operation already holds the restoring workspace, so the restore is refused.
    busy.add('restoring')
    await expect(registry.restore('restoring')).rejects.toThrow('busy')

    const archived = registry.archive('other')
    await finishClosing('other')
    await archived
    expect(registry.archived.size).toBe(MAX_ARCHIVED_WORKSPACES)
  })

  it('tells a person closing with Undo to delete an archive when another workspace took the last place meanwhile', async () => {
    const { registry, open, finishAllClosing } = harness(MAX_ARCHIVED_WORKSPACES - 1)
    open('agent'); open('person')
    const access = {
      mcpTabGroups: () => new Map([['person', { id: 'person', name: 'Client work', deletionProtected: false }]]),
      options: () => ({ endUndo: async () => undefined, offerUndo: vi.fn() }),
      savedTabGroups: () => registry.archived,
      closedTabs: () => [],
      detachedClosedTabs: () => new Set(),
      withTabLabelLifecycle: (run: () => Promise<unknown>) => run(),
      workspaceRegistry: () => registry
    }

    // An agent's archive is still closing its tabs when the person closes another workspace with Undo.
    const agentArchive = registry.archive('agent')
    const personClose = Promise.allSettled([closeWorkspaceForPerson(access as never, 'person')])
    await finishAllClosing()
    await agentArchive
    const [closed] = await personClose

    expect(closed).toMatchObject({ status: 'rejected', reason: expect.objectContaining({ key: 'appErrors.workspace.archiveLimitUndo' }) })
    expect(registry.active.has('person')).toBe(true)
  })

  it('frees the place once a restore finishes', async () => {
    const { registry, open, opening, finishClosing } = harness(MAX_ARCHIVED_WORKSPACES)
    open('other')
    opening.resolve()
    await registry.restore('archived-0')

    const archived = registry.archive('other')
    await finishClosing('other')
    await archived
    expect(registry.archived.size).toBe(MAX_ARCHIVED_WORKSPACES)
  })
})
