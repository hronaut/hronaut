import { MAX_BROWSER_TABS, type BrowserClosedTabState, type BrowserSavedTabGroupState, type BrowserState, type BrowserTabGroupState } from '../../../shared/types.js'
import { MAX_ARCHIVED_WORKSPACES } from '../../../shared/undo.js'
import { LocalizedError } from '../../localized-error.js'
import { archivedWorkspaceBusyError, withSavedWorkspaceOperation } from '../workspace-operations/workspace-operations.js'
import { canonicalStorageId } from '../workspace-storage-deletion.js'
import type { WorkspacePlacement } from '../workspace-registry.js'
import { destroyWorkspaceStorage, workspacePartition } from '../workspace-storage.js'
import type { Browser } from '../browser.js'
import { withTabLabelLifecycle } from '../tab-labels/tab-labels.js'
import { browserState, publishChange } from '../browser-state/browser-state.js'
import { persistedState } from '../browser-state/persisted-state.js'

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

function holdWorkspaceForUndo(browser: Browser, groupId: string): WorkspaceUndo {
  const group = browser.mcpTabGroups.get(groupId)
  const order = [...browser.mcpTabGroups.keys()]
  const index = order.indexOf(groupId)
  const after = index > 0 ? order[index - 1] : undefined
  const before = index >= 0 ? order[index + 1] : undefined
  const undo: WorkspaceUndo = {
    placement: { index: Math.max(0, index), ...(after ? { after } : {}), ...(before ? { before } : {}), ...(group?.pinnedAt ? { pinnedAt: group.pinnedAt } : {}) },
    closedTabs: browser.closedTabs.filter((tab) => tab.mcpGroupId === groupId)
  }
  browser.detachedClosedTabs.add(undo.closedTabs)
  return undo
}

/** Puts the workspace's closed tabs back where they were closed in time, unless clearing the history forgot them. */
function returnClosedTabs(browser: Browser, undo: WorkspaceUndo): void {
  browser.detachedClosedTabs.delete(undo.closedTabs)
  for (const held of undo.closedTabs.splice(0)) {
    if (browser.closedTabs.some((entry) => entry.id === held.id)) continue
    const newer = browser.closedTabs.findIndex((entry) => entry.closedAt > held.closedAt)
    browser.closedTabs.splice(newer < 0 ? browser.closedTabs.length : newer, 0, held)
  }
  if (browser.closedTabs.length > MAX_CLOSED_TABS) browser.closedTabs.splice(0, browser.closedTabs.length - MAX_CLOSED_TABS)
}

function releaseClosedTabs(browser: Browser, undo: WorkspaceUndo): void {
  browser.detachedClosedTabs.delete(undo.closedTabs)
  undo.closedTabs.splice(0)
}

/**
 * Stops holding the workspace's closed tabs aside without Undo: they go back to the recently closed tabs while the
 * workspace is open, as when archiving it failed or it was restored from the archive meanwhile, and are forgotten with
 * it otherwise.
 */
function settleClosedTabs(browser: Browser, groupId: string, undo: WorkspaceUndo): void {
  if (browser.mcpTabGroups.has(groupId)) returnClosedTabs(browser, undo)
  else releaseClosedTabs(browser, undo)
}

/** Archives an open workspace once pending tab label edits settle. */
export async function saveAndCloseTabGroup(browser: Browser, groupId: string): Promise<BrowserSavedTabGroupState> {
  return withTabLabelLifecycle(browser, () => browser.workspaceRegistry.archive(groupId))
}

/** Archives a workspace for the person, with Undo to bring it back as it was. */
export async function archiveWorkspaceForPerson(browser: Browser, groupId: string): Promise<BrowserSavedTabGroupState> {
  const undo = holdWorkspaceForUndo(browser, groupId)
  let archived: BrowserSavedTabGroupState
  try {
    archived = await saveAndCloseTabGroup(browser, groupId)
  } catch (error) {
    settleClosedTabs(browser, groupId, undo)
    throw error
  }
  browser.options.offerUndo?.({
    kind: 'workspace-archived',
    name: archived.name,
    undo: () => restoreArchiveForUndo(browser, archived.id, undo),
    finalize: async () => settleClosedTabs(browser, archived.id, undo)
  })
  return archived
}

/**
 * Restores an archive for Undo where it was in the tab rail, pinned as it was, with the tabs the person had closed in
 * it; false when it was already restored or deleted.
 */
async function restoreArchiveForUndo(browser: Browser, savedGroupId: string, undo: WorkspaceUndo): Promise<boolean> {
  if (!browser.savedTabGroups.has(savedGroupId)) {
    if (browser.closingWorkspace?.id === savedGroupId) browser.closingWorkspace = undefined
    settleClosedTabs(browser, savedGroupId, undo)
    return false
  }
  try {
    await restoreSavedTabGroup(browser, savedGroupId, { placement: undo.placement })
  } catch (error) {
    settleClosedTabs(browser, savedGroupId, undo)
    throw error
  }
  returnClosedTabs(browser, undo)
  publishChange(browser, false)
  return true
}

/** Whether the person just closed this workspace and it waits to be deleted. */
export function isClosingWorkspace(browser: Browser, workspaceId: string): boolean {
  return browser.closingWorkspace?.id === workspaceId
}

/**
 * Closes a workspace for the person with Undo: it is archived first, and its tabs, sign-ins and site data are deleted
 * only once Undo is no longer offered or Hronaut quits. Restored meanwhile, from Undo or elsewhere, it is kept.
 */
export async function closeWorkspaceForPerson(browser: Browser, groupId: string): Promise<BrowserState> {
  const group = browser.mcpTabGroups.get(groupId)
  if (!group) throw new LocalizedError('appErrors.workspace.unavailable', undefined, { message: `Unknown workspace: ${groupId}.` })
  if (group.deletionProtected) throw new LocalizedError('appErrors.workspace.protectedClose', { name: group.name })
  // A workspace closed just before is deleted first, so it does not take the archive place this one needs.
  await browser.options.endUndo?.()
  // Undo needs an archive place; the editor asks first and closes without Undo when the archive is full.
  if (browser.savedTabGroups.size >= MAX_SAVED_TAB_GROUPS) {
    throw new LocalizedError('appErrors.workspace.archiveLimitUndo', { max: MAX_SAVED_TAB_GROUPS, name: group.name })
  }
  const undo = holdWorkspaceForUndo(browser, groupId)
  let archived: BrowserSavedTabGroupState
  try {
    archived = await saveAndCloseTabGroup(browser, groupId)
  } catch (error) {
    settleClosedTabs(browser, groupId, undo)
    // Another workspace archived at the same time can take the last place after the check above.
    if (error instanceof LocalizedError && error.key === 'appErrors.workspace.archiveLimit') {
      throw new LocalizedError('appErrors.workspace.archiveLimitUndo', { max: MAX_SAVED_TAB_GROUPS, name: group.name })
    }
    throw error
  }
  // Only this archive is deleted: not one made after the workspace was restored and archived again.
  const saved = browser.savedTabGroups.get(archived.id)
  const closing = { id: archived.id, kept: false }
  browser.closingWorkspace = closing
  browser.options.offerUndo?.({
    kind: 'workspace-closed',
    name: archived.name,
    undo: () => restoreArchiveForUndo(browser, archived.id, undo),
    finalize: async () => {
      settleClosedTabs(browser, archived.id, undo)
      // It stays marked as closing until deleted, so a restore tried meanwhile still keeps it.
      try {
        if (closing.kept || !saved || browser.savedTabGroups.get(archived.id) !== saved || saved.deletionProtected) return
        // An operation already running on the archive finishes first; one that runs on keeps it archived.
        const deadline = Date.now() + CLOSING_WORKSPACE_BUSY_WAIT_MS
        for (let operation = browser.savedWorkspaceOperations.get(archived.id); operation; operation = browser.savedWorkspaceOperations.get(archived.id)) {
          const remaining = deadline - Date.now()
          if (!operation.settled || remaining <= 0) return
          await Promise.race([operation.settled, new Promise<void>((resolve) => setTimeout(resolve, remaining).unref())])
          await new Promise<void>((resolve) => setImmediate(resolve))
        }
        if (closing.kept || browser.savedTabGroups.get(archived.id) !== saved || saved.deletionProtected) return
        await deleteSavedTabGroup(browser, archived.id)
      } finally {
        if (browser.closingWorkspace === closing) browser.closingWorkspace = undefined
      }
    }
  })
  return browserState(browser)
}

/**
 * Restores an archived workspace once pending tab label edits settle, at the end of the tab rail or, for Undo, where
 * it was, and shows it unless `show` is false, as for an agent. A workspace the person just closed is kept from then on.
 */
export async function restoreSavedTabGroup(
  browser: Browser,
  savedGroupId: string,
  { placement, show = true }: { placement?: WorkspacePlacement; show?: boolean } = {}
): Promise<BrowserTabGroupState> {
  // Any attempt to bring back a workspace the person just closed keeps it, even one that fails.
  if (browser.closingWorkspace?.id === savedGroupId) {
    browser.closingWorkspace!.kept = true
    browser.closingWorkspace = undefined
  }
  return withTabLabelLifecycle(browser, () => browser.workspaceRegistry.restore(savedGroupId, placement, show))
}

/** Changes whether an archived workspace shows in the sidebar and is protected from deletion, unless an operation holds it busy. */
export function updateArchivedWorkspacePreferences(browser: Browser, workspaceId: string, updates: { hiddenFromSidebar?: boolean; deletionProtected?: boolean }): void {
  const group = browser.savedTabGroups.get(workspaceId)
  if (!group) throw new LocalizedError('appErrors.workspace.archivedUnavailable', undefined, { message: 'Archived workspace is unavailable.' })
  const operation = browser.savedWorkspaceOperations.get(workspaceId)
  if (operation) throw archivedWorkspaceBusyError(group.name, operation.action)
  if (updates.hiddenFromSidebar !== undefined) group.hiddenFromSidebar = updates.hiddenFromSidebar
  if (updates.deletionProtected !== undefined) group.deletionProtected = updates.deletionProtected
  publishChange(browser)
}

/**
 * Deletes an archived workspace that is not protected from deletion, with
 * its isolated storage, while no other operation holds it busy, tells whoever
 * keeps what belongs to it, such as its site permissions, and saves the
 * session before returning the archives left.
 */
export async function deleteSavedTabGroup(browser: Browser, savedGroupId: string): Promise<BrowserSavedTabGroupState[]> {
  return withSavedWorkspaceOperation(browser, savedGroupId, 'deleting the archived workspace', async () => {
    const saved = browser.savedTabGroups.get(savedGroupId)
    if (!saved) throw new LocalizedError('appErrors.workspace.archivedUnavailable', undefined, { message: `Unknown saved workspace: ${savedGroupId}.` })
    if (saved.deletionProtected) throw new LocalizedError('appErrors.workspace.protectedDelete', { name: saved.name })
    {
      await browser.assertStorageDeletionOwnership(savedGroupId, saved.storageId)
      await destroyWorkspaceStorage(
        workspacePartition(browser.options.partition, saved.storageId),
        browser.options.configureSession,
        (browserSession) => browser.downloadController.downloadsEnd(browserSession)
      )
    }
    browser.savedTabGroups.delete(savedGroupId)
    browser.deletedWorkspaceStorageIds.add(canonicalStorageId(saved.storageId)!)
    browser.retireWorkspaceContinuity(savedGroupId)
    browser.options.onWorkspaceForgotten?.(savedGroupId)
    publishChange(browser)
    await browser.store.save(() => persistedState(browser))
    return browser.listSavedTabGroups()
  })
}
