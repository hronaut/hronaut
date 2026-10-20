import { describe, expect, it, vi } from 'vitest'
import { WorkspaceRegistry, type ActiveWorkspace, type ArchivedWorkspace } from '../src/main/browser/workspace-registry.js'
import { MAX_ARCHIVED_WORKSPACES } from '../src/shared/undo.js'

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
  return { registry, closeActive, open, finishClosing, opening }
}

describe('workspace archive limit', () => {
  it('lets only one of two archives started together take the last archive place', async () => {
    const { registry, closeActive, open, finishClosing } = harness(MAX_ARCHIVED_WORKSPACES - 1)
    open('a'); open('b')

    const first = registry.archive('a')
    const second = registry.archive('b')
    await expect(second).rejects.toThrow(`Hronaut can keep up to ${MAX_ARCHIVED_WORKSPACES} archived workspaces.`)
    await finishClosing('a')
    await first

    expect(registry.archived.size).toBe(MAX_ARCHIVED_WORKSPACES)
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
    const { registry, open, opening, finishClosing } = harness(MAX_ARCHIVED_WORKSPACES - 1)
    registry.archived.set('restoring', archivedWorkspace('restoring', [{ title: 'Page', url: 'https://example.test/', pinned: false }]))
    open('other')

    const restore = registry.restore('restoring')
    await expect(registry.archive('other')).rejects.toThrow(`Hronaut can keep up to ${MAX_ARCHIVED_WORKSPACES} archived workspaces.`)
    opening.reject(new Error('The tab limit is reached.'))
    const restoreFailure = expect(restore).rejects.toThrow('The tab limit is reached.')
    await finishClosing('restoring')
    await restoreFailure
    expect(registry.archived.size).toBe(MAX_ARCHIVED_WORKSPACES)
    expect(registry.archived.has('restoring')).toBe(true)
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
