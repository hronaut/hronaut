import type { Browser } from '../browser.js'
import { orderedTabs } from '../browser-core.js'
import { MAX_TABS, TAB_STATE_VERSION, type PersistedBrowserState, type PersistedTab } from '../tab-store.js'

/** The tab fields the saved browser state keeps: what the tab shows, its pin, mute, locks, zoom, font, favicon and workspace. */
export interface PersistedStateTab {
  id: string
  title: string
  label?: string
  url: string
  pinned: boolean
  tabMuted: boolean
  humanInteractionLocked: boolean
  tabAgentPaused: boolean
  zoomIsolated: boolean
  defaultFontSize?: number
  faviconDataUrl?: string
  mcpGroupId?: string
}

/** A workspace whose deletion has closed its tabs but not committed yet, as the saved session keeps it meanwhile. */
export interface WorkspaceBeingDeleted {
  /** The tab it showed before the close. */
  activeTabId: string | null
  /** Its tabs as they were saved before the close. */
  tabs: PersistedTab[]
}

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
 * The tabs each workspace being deleted is saved with: every tab it had before the close, in their order, a tab still
 * open as it is now. The closed ones fit in only beside the open tabs, so the saved session never holds more tabs than
 * the next start takes; those that do not fit are left out.
 */
function tabsBeingDeleted(openTabs: readonly PersistedStateTab[], workspaces: ReadonlyMap<string, WorkspaceBeingDeleted>): Map<string, PersistedTab[]> {
  const open = new Map(openTabs.map((tab) => [tab.id, tab]))
  let room = MAX_TABS - openTabs.length
  const saved = new Map<string, PersistedTab[]>()
  for (const [workspaceId, workspace] of workspaces) {
    const tabs: PersistedTab[] = []
    for (const tab of workspace.tabs) {
      const stillOpen = open.get(tab.id)
      if (stillOpen) {
        tabs.push(persistedTab(stillOpen))
      } else if (room > 0) {
        tabs.push({ ...tab })
        room -= 1
      }
    }
    saved.set(workspaceId, tabs)
  }
  return saved
}

/**
 * The browser state Hronaut saves: the tabs in order, the active tab, the
 * split view, the global mute and lock, the open and archived workspaces,
 * and the workspace storage and continuity records. A workspace being
 * deleted is saved as it was before its tabs closed, so a crash before the
 * deletion commits brings it back whole. It throws once the browser is
 * closing, which cancels the save.
 */
export function persistedState(browser: Browser): PersistedBrowserState {
  if (browser.destroyed) throw new Error('Browser is closing; session save canceled.')
  const openTabs = orderedTabs(browser)
  const deleting = tabsBeingDeleted(openTabs, browser.workspacesBeingDeleted)
  // A tab the close has not reached yet, or a failed deletion has reopened, is saved once, in its place.
  const deletingTabIds = new Set([...deleting.values()].flatMap((tabs) => tabs.map((tab) => tab.id)))
  const tabs = [...openTabs.filter((tab) => !deletingTabIds.has(tab.id)).map(persistedTab), ...[...deleting.values()].flat()]
  const savedTabIds = new Set(tabs.map((tab) => tab.id))
  return {
    version: TAB_STATE_VERSION,
    ...(browser.deletedWorkspaceStorageIds.size ? { deletedWorkspaceStorageIds: [...browser.deletedWorkspaceStorageIds] } : {}),
    ...(browser.workspaceStorageCleanupBlocked ? { workspaceStorageCleanupBlocked: true } : {}),
    continuityWorkspaceIds: browser.workspaceContinuity.guardedWorkspaceIds(),
    activeTabId: browser.activeTabId,
    ...(browser.splitView ? { splitView: { ...browser.splitView, ratio: browser.splitDivider.persistedRatio(browser.splitView.ratio) } } : {}),
    allTabsMuted: browser.allTabsMuted,
    allHumanInteractionLocked: browser.allHumanInteractionLocked,
    mcpTabGroups: [...browser.mcpTabGroups.values()].map((group) => {
      const beingDeleted = browser.workspacesBeingDeleted.get(group.id)
      if (!beingDeleted) return { ...group }
      // The tab it showed before the close, unless that one did not fit; then the one the close shows meanwhile.
      const activeTabId = [beingDeleted.activeTabId, group.activeTabId].find((id) => id !== null && savedTabIds.has(id)) ?? null
      return { ...group, activeTabId }
    }),
    savedTabGroups: [...browser.savedTabGroups.values()].map((group) => ({
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
    tabs
  }
}
