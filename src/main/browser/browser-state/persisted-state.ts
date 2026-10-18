import { TAB_STATE_VERSION, type PersistedBrowserState } from '../tab-store.js'
import type { PersistedStateAccess, PersistedStateTab } from './persisted-state-access.js'

/**
 * The browser state Hronaut saves: the tabs in order, the active tab, the
 * split view, the global mute and lock, the open and archived workspaces,
 * and the workspace storage and continuity records. It throws once the
 * browser is closing, which cancels the save.
 */
export function persistedState<Tab extends PersistedStateTab>(access: PersistedStateAccess<Tab>): PersistedBrowserState {
  if (access.isDestroyed()) throw new Error('Browser is closing; session save canceled.')
  return {
    version: TAB_STATE_VERSION,
    ...(access.deletedWorkspaceStorageIds().size ? { deletedWorkspaceStorageIds: [...access.deletedWorkspaceStorageIds()] } : {}),
    ...(access.workspaceStorageCleanupBlocked() ? { workspaceStorageCleanupBlocked: true } : {}),
    continuityWorkspaceIds: access.workspaceContinuity().guardedWorkspaceIds(),
    activeTabId: access.activeTabId(),
    ...(access.splitView() ? { splitView: { ...access.splitView()!, ratio: access.splitDivider().persistedRatio(access.splitView()!.ratio) } } : {}),
    allTabsMuted: access.allTabsMuted(),
    allHumanInteractionLocked: access.allHumanInteractionLocked(),
    mcpTabGroups: [...access.mcpTabGroups().values()].map((group) => ({ ...group })),
    savedTabGroups: [...access.savedTabGroups().values()].map((group) => ({
      id: group.id,
      name: group.name,
      description: group.description,
      color: group.color,
      savedAt: group.savedAt,
      hiddenFromSidebar: group.hiddenFromSidebar === true,
      deletionProtected: group.deletionProtected === true,
      agentAccess: group.agentAccess !== false,
      contextClass: group.contextClass,
      storageId: group.storageId,
      origins: [...group.origins],
      navigationPolicy: {
        mode: group.navigationPolicy.mode,
        rules: [...group.navigationPolicy.rules]
      },
      navigationAudit: group.navigationAudit.map((entry) => ({ ...entry })),
      tabs: group.tabs.map((tab) => ({ ...tab }))
    })),
    tabs: access.orderedTabs().map((tab) => ({
      id: tab.id,
      title: tab.title,
      ...(tab.label ? { label: tab.label } : {}),
      url: tab.url,
      pinned: tab.pinned,
      muted: tab.tabMuted,
      humanInteractionLocked: tab.humanInteractionLocked,
      tabAgentPaused: tab.tabAgentPaused,
      ...(tab.zoomIsolated ? { zoomIsolated: true as const } : {}),
      ...(tab.defaultFontSize ? { defaultFontSize: tab.defaultFontSize } : {}),
      ...(tab.faviconDataUrl ? { faviconDataUrl: tab.faviconDataUrl } : {}),
      ...(tab.mcpGroupId ? { mcpGroupId: tab.mcpGroupId } : {})
    }))
  }
}
