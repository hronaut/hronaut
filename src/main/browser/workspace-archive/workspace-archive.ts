import { MAX_BROWSER_TABS, type BrowserClosedTabState, type BrowserSavedTabGroupState, type BrowserState, type BrowserTabGroupState } from '../../../shared/types.js'
import { MAX_ARCHIVED_WORKSPACES } from '../../../shared/undo.js'
import { LocalizedError } from '../../localized-error.js'
import { archivedWorkspaceBusyError } from '../workspace-operations/workspace-operations.js'
import { canonicalStorageId } from '../workspace-storage-deletion.js'
import type { WorkspacePlacement } from '../workspace-registry.js'
import { destroyWorkspaceStorage, workspacePartition } from '../workspace-storage.js'
import type { WorkspaceArchiveAccess } from './workspace-archive-access.js'

// A copy of the tab manager's limit, which its workspace registry keeps using.
const MAX_SAVED_TAB_GROUPS = MAX_ARCHIVED_WORKSPACES

/** How long deleting a closed workspace waits for an operation on its archive before leaving it archived. */
const CLOSING_WORKSPACE_BUSY_WAIT_MS = 3_000

/** How many recently closed tabs the tab manager remembers; a copy of the tab reopening limit. */
const MAX_CLOSED_TABS = MAX_BROWSER_TABS

/**
 * What Undo puts back besides the archive: the workspace's place in the tab rail and its pin, and the tabs the person
 * had closed in it, which closing the workspace forgets. Those are held aside while Undo is on offer, where clearing
 * the history still forgets them.
 */
interface WorkspaceUndo {
  placement: WorkspacePlacement
  closedTabs: BrowserClosedTabState[]
}

function holdWorkspaceForUndo(access: WorkspaceArchiveAccess, groupId: string): WorkspaceUndo {
  const group = access.mcpTabGroups().get(groupId)
  const order = [...access.mcpTabGroups().keys()]
  const index = order.indexOf(groupId)
  const after = index > 0 ? order[index - 1] : undefined
  const before = index >= 0 ? order[index + 1] : undefined
  const undo: WorkspaceUndo = {
    placement: { index: Math.max(0, index), ...(after ? { after } : {}), ...(before ? { before } : {}), ...(group?.pinnedAt ? { pinnedAt: group.pinnedAt } : {}) },
    closedTabs: access.closedTabs().filter((tab) => tab.mcpGroupId === groupId)
  }
  access.detachedClosedTabs().add(undo.closedTabs)
  return undo
}

/** Puts the workspace's closed tabs back where they were closed in time, unless clearing the history forgot them. */
function returnClosedTabs(access: WorkspaceArchiveAccess, undo: WorkspaceUndo): void {
  access.detachedClosedTabs().delete(undo.closedTabs)
  for (const held of undo.closedTabs.splice(0)) {
    if (access.closedTabs().some((entry) => entry.id === held.id)) continue
    const newer = access.closedTabs().findIndex((entry) => entry.closedAt > held.closedAt)
    access.closedTabs().splice(newer < 0 ? access.closedTabs().length : newer, 0, held)
  }
  if (access.closedTabs().length > MAX_CLOSED_TABS) access.closedTabs().splice(0, access.closedTabs().length - MAX_CLOSED_TABS)
}

function releaseClosedTabs(access: WorkspaceArchiveAccess, undo: WorkspaceUndo): void {
  access.detachedClosedTabs().delete(undo.closedTabs)
  undo.closedTabs.splice(0)
}

/**
 * Stops holding the workspace's closed tabs aside without Undo: they go back to the recently closed tabs while the
 * workspace is open, as when archiving it failed or it was restored from the archive meanwhile, and are forgotten with
 * it otherwise.
 */
function settleClosedTabs(access: WorkspaceArchiveAccess, groupId: string, undo: WorkspaceUndo): void {
  if (access.mcpTabGroups().has(groupId)) returnClosedTabs(access, undo)
  else releaseClosedTabs(access, undo)
}

/** Archives an open workspace once pending tab label edits settle. */
export async function saveAndCloseTabGroup(access: WorkspaceArchiveAccess, groupId: string): Promise<BrowserSavedTabGroupState> {
  return access.withTabLabelLifecycle(() => access.workspaceRegistry().archive(groupId))
}

/** Archives a workspace for the person, with Undo to bring it back as it was. */
export async function archiveWorkspaceForPerson(access: WorkspaceArchiveAccess, groupId: string): Promise<BrowserSavedTabGroupState> {
  const undo = holdWorkspaceForUndo(access, groupId)
  let archived: BrowserSavedTabGroupState
  try {
    archived = await saveAndCloseTabGroup(access, groupId)
  } catch (error) {
    settleClosedTabs(access, groupId, undo)
    throw error
  }
  access.options().offerUndo?.({
    kind: 'workspace-archived',
    name: archived.name,
    undo: () => restoreArchiveForUndo(access, archived.id, undo),
    finalize: async () => settleClosedTabs(access, archived.id, undo)
  })
  return archived
}

/**
 * Restores an archive for Undo where it was in the tab rail, pinned as it was, with the tabs the person had closed in
 * it; false when it was already restored or deleted.
 */
async function restoreArchiveForUndo(access: WorkspaceArchiveAccess, savedGroupId: string, undo: WorkspaceUndo): Promise<boolean> {
  if (!access.savedTabGroups().has(savedGroupId)) {
    if (access.closingWorkspace()?.id === savedGroupId) access.setClosingWorkspace(undefined)
    settleClosedTabs(access, savedGroupId, undo)
    return false
  }
  try {
    await restoreSavedTabGroup(access, savedGroupId, undo.placement)
  } catch (error) {
    settleClosedTabs(access, savedGroupId, undo)
    throw error
  }
  returnClosedTabs(access, undo)
  access.changed(false)
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
  if (group.deletionProtected) throw new LocalizedError('appErrors.workspace.protectedClose', { name: group.name })
  // A workspace closed just before is deleted first, so it does not take the archive place this one needs.
  await access.options().endUndo?.()
  // Undo needs an archive place; the editor asks first and closes without Undo when the archive is full.
  if (access.savedTabGroups().size >= MAX_SAVED_TAB_GROUPS) {
    throw new LocalizedError('appErrors.workspace.archiveLimitUndo', { max: MAX_SAVED_TAB_GROUPS, name: group.name })
  }
  const undo = holdWorkspaceForUndo(access, groupId)
  let archived: BrowserSavedTabGroupState
  try {
    archived = await saveAndCloseTabGroup(access, groupId)
  } catch (error) {
    settleClosedTabs(access, groupId, undo)
    // Another workspace archived at the same time can take the last place after the check above.
    if (error instanceof LocalizedError && error.key === 'appErrors.workspace.archiveLimit') {
      throw new LocalizedError('appErrors.workspace.archiveLimitUndo', { max: MAX_SAVED_TAB_GROUPS, name: group.name })
    }
    throw error
  }
  // Only this archive is deleted: not one made after the workspace was restored and archived again.
  const saved = access.savedTabGroups().get(archived.id)
  const closing = { id: archived.id, kept: false }
  access.setClosingWorkspace(closing)
  access.options().offerUndo?.({
    kind: 'workspace-closed',
    name: archived.name,
    undo: () => restoreArchiveForUndo(access, archived.id, undo),
    finalize: async () => {
      settleClosedTabs(access, archived.id, undo)
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
 * Restores an archived workspace once pending tab label edits settle, at the end of the tab rail or, for Undo, where
 * it was. A workspace the person just closed is kept from then on.
 */
export async function restoreSavedTabGroup(access: WorkspaceArchiveAccess, savedGroupId: string, placement?: WorkspacePlacement): Promise<BrowserTabGroupState> {
  // Any attempt to bring back a workspace the person just closed keeps it, even one that fails.
  if (access.closingWorkspace()?.id === savedGroupId) {
    access.closingWorkspace()!.kept = true
    access.setClosingWorkspace(undefined)
  }
  return access.withTabLabelLifecycle(() => access.workspaceRegistry().restore(savedGroupId, placement))
}

/** Changes whether an archived workspace shows in the sidebar and is protected from deletion, unless an operation holds it busy. */
export function updateArchivedWorkspacePreferences(access: WorkspaceArchiveAccess, workspaceId: string, updates: { hiddenFromSidebar?: boolean; deletionProtected?: boolean }): void {
  const group = access.savedTabGroups().get(workspaceId)
  if (!group) throw new LocalizedError('appErrors.workspace.archivedUnavailable', undefined, { message: 'Archived workspace is unavailable.' })
  const operation = access.savedWorkspaceOperations().get(workspaceId)
  if (operation) throw archivedWorkspaceBusyError(group.name, operation.action)
  if (updates.hiddenFromSidebar !== undefined) group.hiddenFromSidebar = updates.hiddenFromSidebar
  if (updates.deletionProtected !== undefined) group.deletionProtected = updates.deletionProtected
  access.changed()
}

/**
 * Deletes an archived workspace that is not protected from deletion, with
 * its isolated storage, while no other operation holds it busy, tells whoever
 * keeps what belongs to it, such as its site permissions, and saves the
 * session before returning the archives left.
 */
export async function deleteSavedTabGroup(access: WorkspaceArchiveAccess, savedGroupId: string): Promise<BrowserSavedTabGroupState[]> {
  return access.withSavedWorkspaceOperation(savedGroupId, 'deleting the archived workspace', async () => {
    const saved = access.savedTabGroups().get(savedGroupId)
    if (!saved) throw new LocalizedError('appErrors.workspace.archivedUnavailable', undefined, { message: `Unknown saved workspace: ${savedGroupId}.` })
    if (saved.deletionProtected) throw new LocalizedError('appErrors.workspace.protectedDelete', { name: saved.name })
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
    access.options().onWorkspaceForgotten?.(savedGroupId)
    access.changed()
    await access.store().save(() => access.persistedState())
    return access.listSavedTabGroups()
  })
}
