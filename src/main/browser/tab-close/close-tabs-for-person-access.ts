import type { BrowserClosedTabState, BrowserState } from '../../../shared/types.js'
import type { MessageKey, MessageParameters } from '../../../shared/i18n.js'
import type { UndoableAction } from '../../undo-offers.js'

/** The tab fields closing tabs for the person reads: its address, workspace and pin, which place it among its peers. */
export interface PersonTabCloseTab {
  id: string
  url: string
  mcpGroupId?: string
  pinned: boolean
}

/** The tab manager options closing tabs for the person uses: offering Undo. */
export interface PersonTabCloseOptions {
  offerUndo?: (action: UndoableAction) => void
}

/**
 * A close in flight that lets the tab's page ask to stay, with the tab it
 * began on. Only the tab's identity is compared, so a newer tab under the
 * same id starts its own close.
 */
export interface PendingHumanTabClose<Tab> {
  tab: Tab
  operation: Promise<BrowserState>
}

/**
 * What closing tabs for the person, with Undo, and closing a tab once tab
 * label saves have settled need from the tab manager, which keeps the tabs
 * and their order, the recently closed tabs, tab closing and reopening, the
 * closes in flight that let pages ask to stay, tab label saves, tab order,
 * state publication and its options private. The recently closed tabs are
 * read again after each close, since closing a tab adds to them.
 */
export interface PersonTabCloseAccess<Tab extends PersonTabCloseTab> {
  /** The tab with this id, or the active tab; it throws when there is none. */
  getTab(tabId?: string): Tab
  /** The open tab with this id. */
  findTab(tabId: string): Tab | undefined
  /** Every open tab in the order the rail and strip show them. */
  orderedTabs(): Tab[]
  /** The tab shown in the window, if any. */
  activeTabId(): string | null
  /** The recently closed tabs, oldest first. */
  closedTabs(): readonly BrowserClosedTabState[]
  /**
   * Closes a tab, opening a replacement when it was the last, letting its page ask to stay when respectBeforeUnload
   * is set, and keeping a shown tab open when yieldsToNewerSelection is set and another tab is selected while the tab
   * that replaces it wakes.
   */
  closeTabInternal(tabId: string, ensureReplacement: boolean, respectBeforeUnload?: boolean, yieldsToNewerSelection?: boolean): Promise<BrowserState>
  /** The closes in flight that let the tab's page ask to stay, by tab id. */
  pendingHumanTabCloses(): Map<string, PendingHumanTabClose<Tab>>
  /** Closes the tab, opening a replacement when it was the last and ensureReplacement is set. */
  performCloseTab(tabId: string, ensureReplacement: boolean, respectBeforeUnload: boolean, forceClose: boolean, yieldsToNewerSelection: boolean): Promise<BrowserState>
  /** Reopens a recently closed tab, showing it when active is set; undefined when it is no longer there. */
  reopenClosedTabEntry(closedTabId: string | undefined, active: boolean): Promise<Tab | undefined>
  /** Runs an operation once pending tab label edits settle, admitting no new edit until it ends. */
  withTabLabelLifecycle<T>(run: () => Promise<T>): Promise<T>
  /** Moves the tab before or after another tab. */
  reorderTab(tabId: string, targetTabId: string, placement: 'before' | 'after'): BrowserState
  /** The browser state. */
  getState(): BrowserState
  /** The tab manager's options. */
  options(): PersonTabCloseOptions
  /** A message in the interface language, such as the name the Undo offer gives a blank tab. */
  text(key: MessageKey, parameters?: MessageParameters): string
}
