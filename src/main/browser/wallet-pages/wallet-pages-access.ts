import type { WebContents } from 'electron'

export interface BrowserWalletPageContext {
  tabId: string
  workspaceId: string
  navigationGeneration: number
  topLevelOrigin: string
  url: string
}

/**
 * The tab fields the wallet page bridge reads: its id, address, workspace,
 * page, whether it sleeps, its wallet navigation generation and whether its
 * page is unloading.
 */
export interface WalletPagesTab {
  id: string
  url: string
  mcpGroupId?: string
  webContents: WebContents
  sleeping: boolean
  walletNavigationGeneration: number
  walletPageUnloading?: boolean
}

/**
 * What resolving a wallet request's page and sending wallet provider events
 * need from the tab manager, which keeps the tabs, the pages' tab ids and the
 * workspace tab lookup private.
 */
export interface WalletPagesAccess<Tab extends WalletPagesTab> {
  /** The tab with this id, if it is still open. */
  findTab(tabId: string): Tab | undefined
  /** The id of the tab showing the page with this WebContents id. */
  tabIdForWebContents(webContentsId: number): string | undefined
  /** The id of the workspace's tab, or of its active tab, which becomes the workspace's active tab; it throws for a tab outside the workspace. */
  requireTabInMcpGroup(groupId: string, tabId?: string): string
}
