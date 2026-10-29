import type { Browser } from '../browser.js'
import { findTab } from '../browser-core.js'

/** The tab, workspace, navigation generation, top-level origin and address of the page a wallet request is for. */
export interface BrowserWalletPageContext {
  tabId: string
  workspaceId: string
  navigationGeneration: number
  topLevelOrigin: string
  url: string
}

/** The wallet context of the page that sent a wallet request, and whether that page is unloading. */
export function walletPageContext(browser: Browser, webContentsId: number): BrowserWalletPageContext & { pageUnloading: boolean } {
  const context = walletContextForWebContents(browser, webContentsId)
  return { ...context, pageUnloading: findTab(browser, context.tabId)?.walletPageUnloading === true }
}

/** The tab, workspace, navigation generation and HTTP or HTTPS top-level origin of a workspace tab's page; it throws for any other page. */
function walletContextForWebContents(browser: Browser, webContentsId: number): BrowserWalletPageContext {
  const tabId = browser.webContentsToTab.get(webContentsId)
  const tab = tabId ? findTab(browser, tabId) : undefined
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
export function walletPageContextForMcpTab(browser: Browser, workspaceId: string, tabId: string): BrowserWalletPageContext {
  const resolvedTabId = browser.requireTabInMcpGroup(workspaceId, tabId)
  const tab = findTab(browser, resolvedTabId)
  if (!tab || tab.webContents.isDestroyed()) throw new Error('Wallet request target tab is unavailable')
  return walletContextForWebContents(browser, tab.webContents.id)
}

/** Sends a wallet provider event to the tab's page unless it is closed, gone or asleep. */
export function sendWalletProviderEvent(browser: Browser, tabId: string, event: import('../../../shared/wallet.js').WalletProviderEvent): void {
  const tab = findTab(browser, tabId)
  if (!tab || tab.webContents.isDestroyed() || tab.sleeping) return
  tab.webContents.send('wallet-provider:event', structuredClone(event))
}
