import type { WalletBrokerContext } from './broker.js'

export interface WalletIpcPageContext {
  tabId: string
  workspaceId: string
  navigationGeneration: number
  topLevelOrigin: string
  url: string
  /** Going to sleep is replacing the page, which may still run but must not start a wallet call. */
  pageUnloading: boolean
}

export interface WalletIpcContextSource {
  walletPageContext(webContentsId: number): WalletIpcPageContext
}

export interface WalletIpcInvokeEvent {
  sender: {
    id: number
    mainFrame: unknown
  }
  senderFrame?: {
    url: string
  } | null
}

export function walletBrokerContextFromIpc(
  event: WalletIpcInvokeEvent,
  source: WalletIpcContextSource
): WalletBrokerContext {
  if (!event.senderFrame || event.senderFrame !== event.sender.mainFrame) {
    throw new Error('Wallet requests are allowed only from the top-level website frame')
  }
  const context = source.walletPageContext(event.sender.id)
  if (context.pageUnloading) throw new Error('Wallet requests are unavailable while the tab goes to sleep')
  let senderOrigin: string
  try {
    const url = new URL(event.senderFrame.url)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('invalid protocol')
    senderOrigin = url.origin
  } catch {
    throw new Error('Wallet requests require a valid HTTP or HTTPS top-level origin')
  }
  if (senderOrigin !== context.topLevelOrigin) {
    throw new Error('Wallet request origin does not match the active top-level page')
  }
  return {
    workspaceId: context.workspaceId,
    tabId: context.tabId,
    navigationGeneration: context.navigationGeneration,
    topLevelOrigin: context.topLevelOrigin,
    requester: { type: 'website', id: context.topLevelOrigin }
  }
}
