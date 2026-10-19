import type { BrowserTabGroupState } from '../../../shared/types.js'
import { LocalizedError } from '../../localized-error.js'
import { canonicalStorageId } from '../workspace-storage-deletion.js'
import { destroyWorkspaceStorage, workspacePartition } from '../workspace-storage.js'
import type { McpTabGroupsAccess, McpTabGroupsTab } from './mcp-tab-groups-access.js'
import { listMcpTabGroups } from './mcp-tab-groups.js'

/** Hronaut Home, which closing a workspace opens when it leaves no tab; the tab manager's Home address. */
const HRONAUT_HOME_URL = 'hronaut://home/'

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
 * reopening the tabs as they were when that fails. Then forgets the workspace,
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
    navigationGeneration: tab.navigationGeneration,
    navigationHistory: access.navigationHistorySnapshot(tab)
  }))
  const removeClosedWorkspaceTabs = (): void => {
    for (let index = access.closedTabs().length - 1; index >= 0; index -= 1) {
      if (access.closedTabs()[index]?.mcpGroupId === groupId) access.closedTabs().splice(index, 1)
    }
  }
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
        access.options().configureSession
      )
    }
  } catch (error) {
    try {
      await restoreWorkspaceTabs()
    } catch (restoreError) {
      // Keep both the workspace metadata and any recoverable recently closed
      // entries when an Electron failure prevents a complete rollback.
      access.changed()
      throw new LocalizedError('appErrors.workspace.closeRollbackFailed', { name: group.name }, { cause: new AggregateError([error, restoreError]) })
    }
    throw error
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
