import type { WalletProviderEvent, WalletProviderRequest } from '../wallet.js'
import type { EventChannel, InvokeChannel } from './channel.js'

/** The wallet providers Hronaut installs in a website's page, which reach the workspace's agent wallets through main. */
export const WALLET_PROVIDER_IPC = {
  /** Website → main: a request of the page's wallet provider; main answers it as the provider would. */
  request: 'wallet-provider:request' as InvokeChannel<[input: WalletProviderRequest], unknown>,
  /** Main → website: an event of a wallet provider, such as changed accounts or chain. */
  event: 'wallet-provider:event' as EventChannel<[event: WalletProviderEvent]>
} as const
