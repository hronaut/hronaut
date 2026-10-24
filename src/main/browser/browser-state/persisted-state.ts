import { TAB_STATE_VERSION, type PersistedBrowserState, type PersistedTab } from '../tab-store.js'
import type { PersistedStateAccess, PersistedStateTab } from './persisted-state-access.js'

/** What the saved session keeps of a tab: what it shows, its pin, mute, locks, zoom, font, favicon and workspace. */
export function persistedTab(tab: PersistedStateTab): PersistedTab {
  return {
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
  }
}

/**
 * The browser state Hronaut saves: the tabs in order, the active tab, the
 * split view, the global mute and lock, the open and archived workspaces,
 * and the workspace storage and continuity records. A workspace being
 * deleted is saved as it was before its tabs closed, so a crash before the
 * deletion commits brings it back whole. It throws once the browser is
 * closing, which cancels the save.
 */
export function persistedState<Tab extends PersistedStateTab>(access: PersistedStateAccess<Tab>): PersistedBrowserState {
  if (access.isDestroyed()) throw new Error('Browser is closing; session save canceled.')
  const openTabs = access.orderedTabs()
  const openTabIds = new Set(openTabs.map((tab) => tab.id))
  // A tab that a failed deletion has already reopened is open again, and saved once.
  const tabsBeingDeleted = [...access.workspacesBeingDeleted().values()]
    .flatMap((workspace) => workspace.tabs.filter((tab) => !openTabIds.has(tab.id)))
  return {
    version: TAB_STATE_VERSION,
    ...(access.deletedWorkspaceStorageIds().size ? { deletedWorkspaceStorageIds: [...access.deletedWorkspaceStorageIds()] } : {}),
    ...(access.workspaceStorageCleanupBlocked() ? { workspaceStorageCleanupBlocked: true } : {}),
    continuityWorkspaceIds: access.workspaceContinuity().guardedWorkspaceIds(),
    activeTabId: access.activeTabId(),
    ...(access.splitView() ? { splitView: { ...access.splitView()!, ratio: access.splitDivider().persistedRatio(access.splitView()!.ratio) } } : {}),
    allTabsMuted: access.allTabsMuted(),
    allHumanInteractionLocked: access.allHumanInteractionLocked(),
    mcpTabGroups: [...access.mcpTabGroups().values()].map((group) => {
      const beingDeleted = access.workspacesBeingDeleted().get(group.id)
      return beingDeleted ? { ...group, activeTabId: beingDeleted.activeTabId } : { ...group }
    }),
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
      tabs: group.tabs.map((tab) => ({ ...tab })),
      ...(group.shownTabIndex !== undefined ? { shownTabIndex: group.shownTabIndex } : {})
    })),
    tabs: [...openTabs.map(persistedTab), ...tabsBeingDeleted.map((tab) => ({ ...tab }))]
  }
}
