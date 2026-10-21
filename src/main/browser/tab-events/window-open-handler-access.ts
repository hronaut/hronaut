import type { LoadURLOptions, WebContents, WebPreferences } from 'electron'
import type { BrowserWorkspaceNavigationAuditSource } from '../../../shared/types.js'
import type { OpenedTabObservation } from '../click-opened-tabs.js'

/** The tab fields the page's window open handler reads: the tab's id, workspace and page. */
export interface WindowOpenHandlerTab {
  id: string
  mcpGroupId?: string
  webContents: WebContents
}

/** The tab manager option the window open handler uses to report a page it could not open. */
export interface WindowOpenHandlerOptions {
  onActionFailed?: (action: string, error: unknown) => void
}

/**
 * What opening a page's new windows as tabs needs from the tab manager, which
 * keeps the observations of tabs opened during an agent's click, the
 * workspace navigation policy, its options, tab creation and in-flight agent
 * input private. Each member reads the manager when the page asks to open a
 * window.
 */
export interface WindowOpenHandlerAccess<Tab extends WindowOpenHandlerTab> {
  /** The observations watching each tab for tabs it opens during an agent's click. */
  openedTabObservations(): ReadonlyMap<Tab, Set<OpenedTabObservation>>
  /** Whether the workspace's navigation policy lets it open this address, auditing the decision. */
  workspaceNavigationAllowed(groupId: string, url: string, source: BrowserWorkspaceNavigationAuditSource): boolean
  /** The tab manager's options. */
  options(): WindowOpenHandlerOptions
  /** The web preferences of every website tab, which a page opened for a window gets too. */
  pageWebPreferences(): WebPreferences
  /**
   * Opens a new tab, loading its address, or showing the page Chromium created for a window instead, which loads
   * itself.
   */
  createTab(options: {
    url: string
    active: boolean
    selectVisible?: boolean
    mcpGroupId?: string
    loadOptions?: LoadURLOptions
    adopt?: { webContents: WebContents; webPreferences?: WebPreferences }
    onCreated?: (tab: Tab) => void
  }): Promise<Tab>
  /** How many agent input operations are in flight for each page, by WebContents id. */
  agentInputWebContents(): ReadonlyMap<number, number>
}
