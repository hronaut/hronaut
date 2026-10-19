import type { SearchEngineName } from '../../../shared/search-engine.js'
import type { BrowserState, BrowserTabGroupState, BrowserWorkspaceNavigationAuditSource } from '../../../shared/types.js'

/** The tab field opening a new tab reads from the tab it created: its id. */
export interface NewTabsTab {
  id: string
}

/** The tab manager option opening a new tab uses: the search engine for an address that is not a URL. */
export interface NewTabsOptions {
  getSearchEngine?: () => SearchEngineName
}

/** What opening a new tab asks tab creation for. */
export interface NewTabCreation<Tab extends NewTabsTab> {
  url: string
  active: boolean
  selectVisible: boolean
  mcpGroupId: string
  focus?: boolean
  zoomIsolated: boolean
  defaultFontSize?: number
  onCreated?: (tab: Tab) => void
  onCreationAttempt?: () => void
}

/**
 * What opening a new tab, labeled or not, needs from the tab manager, which
 * keeps the tabs, the workspaces, its options, workspace navigation checks,
 * tab creation, Home, label saves and the browser state private.
 */
export interface NewTabsAccess<Tab extends NewTabsTab> {
  /** The tab manager's options. */
  options(): NewTabsOptions
  /** The open tabs by id. */
  tabs(): ReadonlyMap<string, Tab>
  /** The open workspaces by id. */
  mcpTabGroups(): ReadonlyMap<string, unknown>
  /** The workspace of the active tab, or the first one, created when there is none. */
  ensureHumanWorkspace(): string
  /** The open workspace's state; it throws for an unknown workspace. */
  requireMcpTabGroup(groupId: string): BrowserTabGroupState
  /** Throws unless the workspace's navigation policy allows the address. */
  assertWorkspaceNavigationAllowed(groupId: string, url: string, source: BrowserWorkspaceNavigationAuditSource): void
  /** Opens a tab. */
  createTab(options: NewTabCreation<Tab>): Promise<Tab>
  /** Closes the workspace. */
  closeMcpTabGroup(groupId: string): Promise<BrowserTabGroupState[]>
  /** Opens or shows Hronaut Home. */
  openHome(): Promise<BrowserState>
  /** Throws unless a label edit may start now. */
  assertTabLabelAdmission(): void
  /** Saves the tab's label; validateAuthority runs before the save commits and onCommitted once it has. */
  saveTabLabel(tabId: string, value: string, validateAuthority?: () => void, onCommitted?: () => void): Promise<{ state: BrowserState; status: 'saved' | 'durability-unconfirmed' }>
  /** The browser state. */
  getState(): BrowserState
}
