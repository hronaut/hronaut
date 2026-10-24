import { MAX_BROWSER_TABS, type BrowserTabGroupState } from '../../../shared/types.js'
import { LocalizedError } from '../../localized-error.js'
import { persistedTab } from '../browser-state/persisted-state.js'
import { canonicalStorageId } from '../workspace-storage-deletion.js'
import { destroyWorkspaceStorage, workspacePartition } from '../workspace-storage.js'
import type { McpTabGroupsAccess, McpTabGroupsTab } from './mcp-tab-groups-access.js'
import { listMcpTabGroups } from './mcp-tab-groups.js'

/** Hronaut Home, which closing a workspace opens when it leaves no tab; the tab manager's Home address. */
const HRONAUT_HOME_URL = 'hronaut://home/'

/** How many recently closed tabs the tab manager remembers; a copy of the tab reopening limit. */
const MAX_CLOSED_TABS = MAX_BROWSER_TABS

/**
 * Closes an open workspace and deletes its storage, or keeps the storage when
 * archiving it, while no other operation changes the workspace.
 */
export async function closeMcpTabGroup<Tab extends McpTabGroupsTab>(access: McpTabGroupsAccess<Tab>, groupId: string, preserveStorage = false): Promise<BrowserTabGroupState[]> {
  return access.withWorkspaceOperation(groupId, preserveStorage ? 'archiving the workspace' : 'closing the workspace', () => (
    closeMcpTabGroupInternal(access, groupId, preserveStorage)
  ))
}

/** Closes an open workspace once pending tab label edits settle, for the workspace registry, which already holds it busy. */
export function closeMcpTabGroupInternal<Tab extends McpTabGroupsTab>(access: McpTabGroupsAccess<Tab>, groupId: string, preserveStorage = false): Promise<BrowserTabGroupState[]> {
  return access.withTabLabelLifecycle(() => closeMcpTabGroupAfterLabelSave(access, groupId, preserveStorage))
}

/**
 * Closes the workspace's tabs and, unless archiving, deletes its storage,
 * keeping the tabs in the saved session until it commits and reopening them
 * as they were when that fails. Then forgets the workspace,
 * its recently closed tabs and its continuity checkpoint, tells its wallets
 * and, after a deletion, whoever keeps what belongs to it, such as its site
 * permissions, opens Home when no tab is left and saves the session after a
 * deletion.
 */
async function closeMcpTabGroupAfterLabelSave<Tab extends McpTabGroupsTab>(access: McpTabGroupsAccess<Tab>, groupId: string, preserveStorage: boolean): Promise<BrowserTabGroupState[]> {
  const group = access.mcpTabGroups().get(groupId)
  if (!group) throw new LocalizedError('appErrors.workspace.unavailable', undefined, { message: `Unknown workspace: ${groupId}.` })
  if (!preserveStorage && group.deletionProtected) throw new LocalizedError('appErrors.workspace.protectedClose', { name: group.name })
  access.invalidateReactInspectionWorkspace(groupId)
  const previousActiveTabId = access.activeTabId()
  const previousSelectionGeneration = access.tabSelectionGeneration()
  const previousGroupActiveTabId = group.activeTabId
  const tabs = access.orderedTabs().filter((tab) => tab.mcpGroupId === groupId)
  const tabSnapshots = tabs.map((tab) => ({
    id: tab.id,
    title: tab.title,
    label: tab.label,
    url: tab.url,
    pinned: tab.pinned,
    humanInteractionLocked: tab.humanInteractionLocked,
    tabAgentPaused: tab.tabAgentPaused,
    zoomIsolated: tab.zoomIsolated,
    defaultFontSize: tab.defaultFontSize,
    muted: tab.tabMuted,
    // A restored tab starts past every page the closed one showed, wallet pages included, so none of their wallet
    // requests counts as the restored tab's.
    navigationGeneration: Math.max(tab.navigationGeneration, tab.walletNavigationGeneration),
    navigationHistory: access.navigationHistorySnapshot(tab)
  }))
  // Closing each tab remembers it among the recently closed tabs, whose bounded list would then push out the oldest
  // tabs closed elsewhere, although this workspace's entries leave again below. Those are held aside meanwhile, so a
  // tab the person closed in another workspace stays recoverable, where clearing the history still forgets them.
  const overflow = access.closedTabs().length + tabSnapshots.length - MAX_CLOSED_TABS
  const heldClosedTabs = overflow > 0 ? access.closedTabs().splice(0, overflow) : []
  access.detachedClosedTabs().add(heldClosedTabs)
  const returnHeldClosedTabs = (removeWorkspaceEntries: boolean): void => {
    access.detachedClosedTabs().delete(heldClosedTabs)
    if (removeWorkspaceEntries) {
      for (let index = access.closedTabs().length - 1; index >= 0; index -= 1) {
        if (access.closedTabs()[index]?.mcpGroupId === groupId) access.closedTabs().splice(index, 1)
      }
    }
    // Each goes back where it was closed in time, also among tabs another workspace's close holds aside meanwhile.
    // They were older than every entry left in the list, so they go before entries closed at the same moment.
    for (const held of heldClosedTabs.splice(0).reverse()) {
      // The workspace's own oldest entries can be among those held aside; they leave with its other entries.
      if (removeWorkspaceEntries && held.mcpGroupId === groupId) continue
      const newer = access.closedTabs().findIndex((entry) => entry.closedAt >= held.closedAt)
      access.closedTabs().splice(newer < 0 ? access.closedTabs().length : newer, 0, held)
    }
    if (access.closedTabs().length > MAX_CLOSED_TABS) access.closedTabs().splice(0, access.closedTabs().length - MAX_CLOSED_TABS)
  }
  const removeClosedWorkspaceTabs = (): void => returnHeldClosedTabs(true)
  const restoreWorkspaceTabs = async (): Promise<void> => {
    for (const tab of tabSnapshots) {
      if (access.tabs().has(tab.id)) continue
      const navigationGeneration = tab.navigationGeneration + 1
      await access.options().onWalletTabRestored?.(tab.id, navigationGeneration)
      try {
        await access.createTab({
          ...tab,
          navigationGeneration,
          suppressInitialHistory: true,
          active: false,
          mcpGroupId: groupId,
          allowBusyWorkspace: true
        })
      } catch (error) {
        access.runWalletLifecycleAction('cancel wallet requests after closing a restored tab', () => (
          access.options().onWalletTabClosed?.(tab.id)
        ))
        throw error
      }
    }
    if (previousGroupActiveTabId && access.tabs().get(previousGroupActiveTabId)?.mcpGroupId === groupId) {
      group.activeTabId = previousGroupActiveTabId
    }
    // Closing the shown tab of this workspace shows another tab once; any other selection since the close began is
    // the person's or an agent's newer choice, which the rollback keeps.
    const ownSelections = tabSnapshots.some((tab) => tab.id === previousActiveTabId) ? 1 : 0
    if (
      previousActiveTabId
      && access.tabs().has(previousActiveTabId)
      && access.tabSelectionGeneration() - previousSelectionGeneration <= ownSelections
    ) access.selectTab(previousActiveTabId)
    removeClosedWorkspaceTabs()
    access.changed()
  }
  // Deleting the storage can take long. Until it commits, the saved session keeps the workspace as it was, so a crash
  // meanwhile brings it back with its tabs instead of empty.
  if (!preserveStorage) access.workspacesBeingDeleted().set(groupId, { activeTabId: previousGroupActiveTabId, tabs: tabs.map(persistedTab) })
  try {
    await access.closeTabs(tabSnapshots.map((tab) => tab.id), false)
    // A tab left open would name a workspace the saved session no longer has, which the next start refuses to load.
    if ([...access.tabs().values()].some((tab) => tab.mcpGroupId === groupId)) {
      throw new LocalizedError('appErrors.workspace.tabStillOpen', { name: group.name })
    }
    if (!preserveStorage) {
      await access.assertStorageDeletionOwnership(groupId, group.storageId)
      await destroyWorkspaceStorage(
        workspacePartition(access.options().partition, group.storageId),
        access.options().configureSession,
        (browserSession) => access.downloadsEnd(browserSession)
      )
    }
  } catch (error) {
    try {
      await restoreWorkspaceTabs()
    } catch (restoreError) {
      // Keep both the workspace metadata and any recoverable recently closed
      // entries when an Electron failure prevents a complete rollback.
      returnHeldClosedTabs(false)
      access.changed()
      throw new LocalizedError('appErrors.workspace.closeRollbackFailed', { name: group.name }, { cause: new AggregateError([error, restoreError]) })
    }
    throw error
  } finally {
    access.workspacesBeingDeleted().delete(groupId)
  }
  removeClosedWorkspaceTabs()
  access.mcpTabGroups().delete(groupId)
  if (!preserveStorage) access.deletedWorkspaceStorageIds().add(canonicalStorageId(group.storageId)!)
  if (preserveStorage) access.suspendWorkspaceContinuity(groupId)
  else access.retireWorkspaceContinuity(groupId)
  access.options().onWorkspaceClosed?.(groupId)
  if (!preserveStorage) access.options().onWorkspaceForgotten?.(groupId)
  access.runWalletLifecycleAction('cancel wallet access after closing a workspace', () => (
    access.options().onWalletWorkspaceClosed?.(groupId)
  ))
  if (!access.tabs().size) {
    try {
      await access.createTab({ url: HRONAUT_HOME_URL, active: true })
    } catch (error) {
      // Workspace storage/ownership has already transitioned. A failed
      // replacement view must not prevent the caller from saving its archive.
      access.options().onActionFailed?.('open Home after closing a workspace', error)
    }
  }
  access.changed()
  if (!preserveStorage) await access.store().save(() => access.persistedState())
  return listMcpTabGroups(access)
}
