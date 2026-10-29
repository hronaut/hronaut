import type { BrowserWindow, MenuItemConstructorOptions, WebContents } from 'electron'
import type { MessageKey, MessageParameters } from '../../../shared/i18n.js'
import type { ReactInspectionCommand } from '../../../shared/react-inspection.js'
import type { BrowserSplitOrientation, BrowserSplitViewState } from '../../../shared/split-view.js'
import type { TabPosition } from '../../../shared/tab-position.js'
import type { BrowserPageLifecycleState, BrowserState } from '../../../shared/types.js'
import type { ReactInspectionAuthority, ReactInspectionController } from '../react-inspection.js'
import type { ActiveWorkspace } from '../workspace-registry.js'

/** The tab fields the tab context menu reads: what the tab shows, where it sits, and the states its items toggle. */
export interface TabContextMenuTab {
  id: string
  title: string
  url: string
  mcpGroupId?: string
  pinned: boolean
  sleeping: boolean
  loading: boolean
  muted: boolean
  pageLifecycleState: BrowserPageLifecycleState
  webContents: WebContents
}

/** The tab manager options the tab context menu uses: failed action reports, the tab strip position and attention requests. */
export interface TabContextMenuOptions {
  onActionFailed?: (action: string, error: unknown) => void
  getTabPosition: () => TabPosition
  getTabAttention?: (tabId: string, workspaceId: string | undefined) => { id: string } | undefined
  resolveTabAttention?: (id: string, tabId: string, workspaceId: string | undefined) => void
}

/**
 * What the tab context menu needs from the tab manager, which keeps the
 * tabs, the active tab, the open workspaces, the split view, the recently
 * closed tabs, the window, its options, localized text, React inspection and
 * every tab command the menu offers private. The menu reads the tabs when it
 * opens; each action calls the manager when it runs, not when the menu opens.
 */
export interface TabContextMenuAccess<Tab extends TabContextMenuTab> {
  /** The tab with this id, or the active tab; it throws when there is none. */
  getTab(tabId?: string): Tab
  /** Every open tab in the order the rail and strip show them. */
  orderedTabs(): Tab[]
  /** The tab the window shows. */
  activeTabId(): string | null
  /** The open tab with this id. */
  findTab(tabId: string): Tab | undefined
  /** The tab manager's options. */
  options(): TabContextMenuOptions
  /** The open workspaces by id. */
  mcpTabGroups(): ReadonlyMap<string, ActiveWorkspace>
  /** The localized text for the key. */
  text(key: MessageKey, parameters?: MessageParameters): string
  /** The items of a workspace's own context menu, shown as the tab menu's workspace submenu. */
  workspaceContextMenuItems(group: ActiveWorkspace): MenuItemConstructorOptions[]
  /** Shows a tab, waking it first. */
  selectTabAndWait(tabId: string): Promise<BrowserState>
  /** Wakes the active tab and this one, then opens them side by side. */
  openSplitViewAndWait(tabId: string): Promise<BrowserState>
  /** Whether the tab is one of the split view's panes. */
  splitViewContains(tabId: string): boolean
  /** The split view, if one is open. */
  splitView(): BrowserSplitViewState | null
  /** Changes the split view's orientation, ratio or tab order. */
  updateSplitView(updates: { orientation?: BrowserSplitOrientation; ratio?: number; swap?: boolean }): BrowserState
  /** Closes the split view. */
  closeSplitView(): BrowserState
  /** Reloads the tab's page. */
  reload(tabId: string): Promise<BrowserState>
  /** Reloads the tab's page without the cache. */
  reloadIgnoringCache(tabId: string): Promise<BrowserState>
  /** Opens a copy of the tab next to it. */
  duplicateTab(tabId: string): Promise<BrowserState>
  /** The React inspection controller, for the tab's inspection status. */
  reactInspectionController(): Pick<ReactInspectionController, 'status'>
  /** Turns React inspection on or off in the tab. */
  reactInspection(tabId: string, command: ReactInspectionCommand, authority: ReactInspectionAuthority): ReturnType<ReactInspectionController['run']>
  /** Mutes or unmutes the tab. */
  setTabMuted(tabId: string, muted: boolean): BrowserState
  /** Whether the tab shows a website Mute Site can mute. */
  canMuteSite(tab: Tab): boolean
  /** Whether the tab's website is muted in its workspace. */
  isSiteMuted(tab: Tab): boolean
  /** Mutes or unmutes the tab's website in every tab of its workspace. */
  setSiteMuted(tabId: string, muted: boolean): Promise<BrowserState>
  /** Pins or unpins the tab. */
  setTabPinned(tabId: string, pinned: boolean): Promise<BrowserState>
  /** Freezes or resumes the tab's page. */
  setTabPageLifecycle(tabId: string, state: Exclude<BrowserPageLifecycleState, 'unknown'>): Promise<BrowserState>
  /** Why the tab cannot be put to sleep now, or undefined when it can. */
  sleepBlockReason(tab: Tab, allowActiveTab?: boolean): string | undefined
  /** The tab shown instead when the active tab goes to sleep, if there is one. */
  sleepFallbackTab(tab: Tab): Tab | undefined
  /** Puts the tab to sleep or wakes it as the person asked. */
  setTabSleepingFromContextMenu(tabId: string, sleeping: boolean): Promise<void>
  /** Moves the tab before or after another tab. */
  reorderTab(tabId: string, targetTabId: string, placement: 'before' | 'after'): BrowserState
  /** Closes tabs as the person asked, with Undo. */
  closeTabsForPerson(tabIds: readonly string[]): Promise<BrowserState>
  /** The recently closed tabs. */
  closedTabs(): readonly unknown[]
  /** Reopens the most recently closed tab. */
  reopenClosedTab(): Promise<BrowserState>
  /** The browser window. */
  window(): BrowserWindow
}
