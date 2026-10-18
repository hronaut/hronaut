import type { BrowserWalletPageContext, WalletPagesAccess, WalletPagesTab } from './wallet-pages-access.js'

/** The wallet context of the page that sent a wallet request, and whether that page is unloading. */
export function walletPageContext<Tab extends WalletPagesTab>(access: WalletPagesAccess<Tab>, webContentsId: number): BrowserWalletPageContext & { pageUnloading: boolean } {
  const context = walletContextForWebContents(access, webContentsId)
  return { ...context, pageUnloading: access.findTab(context.tabId)?.walletPageUnloading === true }
}

/** The tab, workspace, navigation generation and HTTP or HTTPS top-level origin of a workspace tab's page; it throws for any other page. */
function walletContextForWebContents<Tab extends WalletPagesTab>(access: WalletPagesAccess<Tab>, webContentsId: number): BrowserWalletPageContext {
  const tabId = access.tabIdForWebContents(webContentsId)
  const tab = tabId ? access.findTab(tabId) : undefined
  if (!tab || tab.webContents.isDestroyed() || tab.webContents.id !== webContentsId) {
    throw new Error('Wallet request did not originate from an active browser tab')
  }
  if (!tab.mcpGroupId) throw new Error('Wallets are unavailable on Hronaut application pages')
  const url = tab.webContents.getURL() || tab.url
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error('Wallets require an HTTP or HTTPS top-level page')
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Wallets require an HTTP or HTTPS top-level page')
  }
  return {
    tabId: tab.id,
    workspaceId: tab.mcpGroupId,
    navigationGeneration: tab.walletNavigationGeneration,
    topLevelOrigin: parsed.origin,
    url: parsed.href
  }
}

/** The wallet context of a workspace tab's page, for an agent's wallet request. */
export function walletPageContextForMcpTab<Tab extends WalletPagesTab>(access: WalletPagesAccess<Tab>, workspaceId: string, tabId: string): BrowserWalletPageContext {
  const resolvedTabId = access.requireTabInMcpGroup(workspaceId, tabId)
  const tab = access.findTab(resolvedTabId)
  if (!tab || tab.webContents.isDestroyed()) throw new Error('Wallet request target tab is unavailable')
  return walletContextForWebContents(access, tab.webContents.id)
}

/** Sends a wallet provider event to the tab's page unless it is closed, gone or asleep. */
export function sendWalletProviderEvent<Tab extends WalletPagesTab>(access: WalletPagesAccess<Tab>, tabId: string, event: import('../../../shared/wallet.js').WalletProviderEvent): void {
  const tab = access.findTab(tabId)
  if (!tab || tab.webContents.isDestroyed() || tab.sleeping) return
  tab.webContents.send('wallet-provider:event', structuredClone(event))
}
