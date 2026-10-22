import type { BrowserWindow } from 'electron'
import type { MessageKey, MessageParameters } from '../../../shared/i18n.js'
import type { BrowserSavedTabGroupState, BrowserState } from '../../../shared/types.js'

/** The tab fields the workspace context menu reads: its workspace and whether it sleeps. */
export interface WorkspaceContextMenuTab {
  mcpGroupId?: string
  sleeping: boolean
}

/** The tab manager option the workspace context menu uses for reporting failed actions. */
export interface WorkspaceContextMenuOptions {
  onActionFailed?: (action: string, error: unknown) => void
}

/**
 * What the workspace context menu needs from the tab manager, which keeps the
 * tabs, the window, its options, localized text, the human interaction lock,
 * workspace pinning, sleeping and archiving private. Each menu
 * action reads the manager when it runs, not when the menu opens.
 */
export interface WorkspaceContextMenuAccess<Tab extends WorkspaceContextMenuTab> {
  /** The open tabs. */
  tabs(): IterableIterator<Tab>
  /** The browser window. */
  window(): BrowserWindow
  /** The tab manager's options. */
  options(): WorkspaceContextMenuOptions
  /** The localized text for the key. */
  text(key: MessageKey, parameters?: MessageParameters): string
  /** Whether the person's input to every page is locked. */
  allHumanInteractionLocked(): boolean
  /** Why the tab cannot be put to sleep now, or undefined when it can. */
  sleepBlockReason(tab: Tab): string | undefined
  /** Pins the workspace to the top of the tab rail, or unpins it. */
  setWorkspacePinned(groupId: string, pinned: boolean): BrowserState
  /** Puts the workspace's eligible tabs to sleep. */
  sleepWorkspaceTabs(groupId: string): Promise<void>
  /** Archives the workspace as the person asked. */
  archiveWorkspaceForPerson(groupId: string): Promise<BrowserSavedTabGroupState>
}
