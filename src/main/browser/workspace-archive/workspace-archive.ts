import type { BrowserSavedTabGroupState, BrowserState, BrowserTabGroupState } from '../../../shared/types.js'
import { MAX_ARCHIVED_WORKSPACES } from '../../../shared/undo.js'
import { LocalizedError } from '../../localized-error.js'
import { canonicalStorageId } from '../workspace-storage-deletion.js'
import { destroyWorkspaceStorage, workspacePartition } from '../workspace-storage.js'
import type { WorkspaceArchiveAccess } from './workspace-archive-access.js'

// A copy of the tab manager's limit, which its workspace registry keeps using.
const MAX_SAVED_TAB_GROUPS = MAX_ARCHIVED_WORKSPACES

/** How long deleting a closed workspace waits for an operation on its archive before leaving it archived. */
const CLOSING_WORKSPACE_BUSY_WAIT_MS = 3_000

/** Archives an open workspace once pending tab label edits settle. */
export async function saveAndCloseTabGroup(access: WorkspaceArchiveAccess, groupId: string): Promise<BrowserSavedTabGroupState> {
  return access.withTabLabelLifecycle(() => access.workspaceRegistry().archive(groupId))
}

/** Archives a workspace for the person, with Undo to bring it back. */
export async function archiveWorkspaceForPerson(access: WorkspaceArchiveAccess, groupId: string): Promise<BrowserSavedTabGroupState> {
  const archived = await saveAndCloseTabGroup(access, groupId)
  access.options().offerUndo?.({
    kind: 'workspace-archived',
    name: archived.name,
    undo: () => restoreArchiveForUndo(access, archived.id)
  })
  return archived
}

/** Restores an archive for Undo; false when it was already restored or deleted. */
async function restoreArchiveForUndo(access: WorkspaceArchiveAccess, savedGroupId: string): Promise<boolean> {
  if (!access.savedTabGroups().has(savedGroupId)) {
    if (access.closingWorkspace()?.id === savedGroupId) access.setClosingWorkspace(undefined)
    return false
  }
  await restoreSavedTabGroup(access, savedGroupId)
  return true
}

/** Whether the person just closed this workspace and it waits to be deleted. */
export function isClosingWorkspace(access: WorkspaceArchiveAccess, workspaceId: string): boolean {
  return access.closingWorkspace()?.id === workspaceId
}

/**
 * Closes a workspace for the person with Undo: it is archived first, and its tabs, sign-ins and site data are deleted
 * only once Undo is no longer offered or Hronaut quits. Restored meanwhile, from Undo or elsewhere, it is kept.
 */
export async function closeWorkspaceForPerson(access: WorkspaceArchiveAccess, groupId: string): Promise<BrowserState> {
  const group = access.mcpTabGroups().get(groupId)
  if (!group) throw new LocalizedError('appErrors.workspace.unavailable', undefined, { message: `Unknown workspace: ${groupId}.` })
  if (group.deletionProtected) throw new Error(`Workspace "${group.name}" is protected from deletion. Turn off deletion protection in workspace settings first.`)
  // A workspace closed just before is deleted first, so it does not take the archive place this one needs.
  await access.options().endUndo?.()
  // Undo needs an archive place; the editor asks first and closes without Undo when the archive is full.
  if (access.savedTabGroups().size >= MAX_SAVED_TAB_GROUPS) {
    throw new Error(`Hronaut keeps at most ${MAX_SAVED_TAB_GROUPS} archived workspaces, so "${group.name}" cannot be closed with Undo. Delete an archived workspace in Home, then try again.`)
  }
  const archived = await saveAndCloseTabGroup(access, groupId)
  // Only this archive is deleted: not one made after the workspace was restored and archived again.
  const saved = access.savedTabGroups().get(archived.id)
  const closing = { id: archived.id, kept: false }
  access.setClosingWorkspace(closing)
  access.options().offerUndo?.({
    kind: 'workspace-closed',
    name: archived.name,
    undo: () => restoreArchiveForUndo(access, archived.id),
    finalize: async () => {
      // It stays marked as closing until deleted, so a restore tried meanwhile still keeps it.
      try {
        if (closing.kept || !saved || access.savedTabGroups().get(archived.id) !== saved || saved.deletionProtected) return
        // An operation already running on the archive finishes first; one that runs on keeps it archived.
        const deadline = Date.now() + CLOSING_WORKSPACE_BUSY_WAIT_MS
        for (let operation = access.savedWorkspaceOperations().get(archived.id); operation; operation = access.savedWorkspaceOperations().get(archived.id)) {
          const remaining = deadline - Date.now()
          if (!operation.settled || remaining <= 0) return
          await Promise.race([operation.settled, new Promise<void>((resolve) => setTimeout(resolve, remaining).unref())])
          await new Promise<void>((resolve) => setImmediate(resolve))
        }
        if (closing.kept || access.savedTabGroups().get(archived.id) !== saved || saved.deletionProtected) return
        await deleteSavedTabGroup(access, archived.id)
      } finally {
        if (access.closingWorkspace() === closing) access.setClosingWorkspace(undefined)
      }
    }
  })
  return access.getState()
}

/**
 * Restores an archived workspace once pending tab label edits settle. A
 * workspace the person just closed is kept from then on.
 */
export async function restoreSavedTabGroup(access: WorkspaceArchiveAccess, savedGroupId: string): Promise<BrowserTabGroupState> {
  // Any attempt to bring back a workspace the person just closed keeps it, even one that fails.
  if (access.closingWorkspace()?.id === savedGroupId) {
    access.closingWorkspace()!.kept = true
    access.setClosingWorkspace(undefined)
  }
  return access.withTabLabelLifecycle(() => access.workspaceRegistry().restore(savedGroupId))
}

/** Changes whether an archived workspace shows in the sidebar and is protected from deletion, unless an operation holds it busy. */
export function updateArchivedWorkspacePreferences(access: WorkspaceArchiveAccess, workspaceId: string, updates: { hiddenFromSidebar?: boolean; deletionProtected?: boolean }): void {
  const group = access.savedTabGroups().get(workspaceId)
  if (!group) throw new Error('Archived workspace is unavailable.')
  const operation = access.savedWorkspaceOperations().get(workspaceId)
  if (operation) throw new Error(`Archived workspace "${group.name}" is busy ${operation.action}. Try again after that operation finishes.`)
  if (updates.hiddenFromSidebar !== undefined) group.hiddenFromSidebar = updates.hiddenFromSidebar
  if (updates.deletionProtected !== undefined) group.deletionProtected = updates.deletionProtected
  access.changed()
}

/**
 * Deletes an archived workspace that is not protected from deletion, with
 * its isolated storage, while no other operation holds it busy, and saves the
 * session before returning the archives left.
 */
export async function deleteSavedTabGroup(access: WorkspaceArchiveAccess, savedGroupId: string): Promise<BrowserSavedTabGroupState[]> {
  return access.withSavedWorkspaceOperation(savedGroupId, 'deleting the archived workspace', async () => {
    const saved = access.savedTabGroups().get(savedGroupId)
    if (!saved) throw new Error(`Unknown saved workspace: ${savedGroupId}.`)
    if (saved.deletionProtected) throw new Error(`Workspace "${saved.name}" is protected from deletion. Turn off deletion protection in Home first.`)
    {
      await access.assertStorageDeletionOwnership(savedGroupId, saved.storageId)
      await destroyWorkspaceStorage(
        workspacePartition(access.options().partition, saved.storageId),
        access.options().configureSession
      )
    }
    access.savedTabGroups().delete(savedGroupId)
    access.deletedWorkspaceStorageIds().add(canonicalStorageId(saved.storageId)!)
    access.retireWorkspaceContinuity(savedGroupId)
    access.changed()
    await access.store().save(() => access.persistedState())
    return access.listSavedTabGroups()
  })
}
