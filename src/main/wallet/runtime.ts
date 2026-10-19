import { app, dialog, safeStorage, type IpcMainInvokeEvent } from 'electron'
import { join } from 'node:path'
import { WalletBroker, type WalletBrokerContext } from './broker.js'
import { walletBrokerContextFromIpc } from './ipc-context.js'
import type { WalletSafeStorage } from './key-provider.js'
import { generateWalletWithRecoveryConfirmation } from './onboarding.js'
import { WalletService } from './service.js'
import { walletStartupFailureStatus } from './startup-status.js'
import type { BrowserTabsManager } from '../browser/tabs-manager.js'
import type { CommercialLicenseStore } from '../commercial-license-store.js'
import type { WalletAgentOperations, WalletAgentToolTarget } from '../mcp/server.js'
import type { MainWindowRefs } from '../windows/main-window.js'
import type { MessageKey, MessageParameters } from '../../shared/i18n.js'
import type { WalletCreateInput, WalletDescriptor, WalletServiceStatus } from '../../shared/wallet.js'

/**
 * The wallet service and its broker, created once by index.ts. They start together after the license store and are
 * cleared together when they cannot start or the runtime shuts down; every reader reads the fields when it runs, so
 * it always sees the current service.
 */
export interface WalletRuntimeState {
  /** The wallet service once it started; null before then, when it could not start and after shutdown. */
  service: WalletService | null
  /** The broker for page and agent wallet requests, which exists whenever the service does. */
  broker: WalletBroker | null
  /** Why wallets are unavailable, which the wallet status reports while there is no service. */
  unavailableStatus: WalletServiceStatus
}

interface WalletRuntimeHost {
  /** The wallet service and broker; index.ts creates the record, and the wallet IPC, tab callbacks and shutdown read it. */
  state: WalletRuntimeState
  sendToMainWindow(channel: string, ...args: unknown[]): void
  /** The license store, which admits agents to wallets; null until startup configures it. */
  commercialLicenseStore(): Pick<CommercialLicenseStore, 'assertAutomationAccess'> | null
  /** The tab runtime, which owns the pages wallets serve; null until the window opens. */
  tabs(): Pick<BrowserTabsManager, 'walletPageContext' | 'walletPageContextForMcpTab' | 'sendWalletProviderEvent'> | null
  /** Why saved workspaces could not start, if they could not; read on every page request. */
  workspaceStartupFailure(): Error | undefined
  /** The main window, which owns the recovery phrase dialog; read on every use because it can close. */
  mainWindowRefs: Pick<MainWindowRefs, 'window'>
  /** A message in the interface language, for the recovery phrase dialog. */
  text(key: MessageKey, parameters?: MessageParameters): string
}

/**
 * Wallets at runtime: starting the wallet service and its broker, which stay off with a reported reason when the
 * wallet data cannot be opened, admitting wallet requests from pages and agents for the page they came from, and
 * generating a wallet only after the person confirms in a native dialog that they saved its recovery phrase. The
 * phrase is shown only in that dialog, never sent to a renderer. `agentWallets` is what the MCP server offers agents.
 */
export function createWalletRuntime(host: WalletRuntimeHost): {
  startWallets(): Promise<void>
  assertWalletPageSender(event: IpcMainInvokeEvent): WalletBrokerContext
  currentWalletServiceStatus(): WalletServiceStatus
  generateWallet(input: WalletCreateInput): Promise<WalletDescriptor>
  agentWallets: WalletAgentOperations
} {
  async function startWallets(): Promise<void> {
    const candidateWalletService = new WalletService({
      directory: join(app.getPath('userData'), 'wallet'),
      platform: process.platform,
      safeStorage: safeStorage as unknown as WalletSafeStorage,
      onChanged: (wallets) => {
        host.sendToMainWindow('wallets:changed', wallets)
        host.state.broker?.refreshProviderSessions()
      },
      onStatusChanged: (status) => host.sendToMainWindow('wallets:status-changed', status),
      warn: (message) => console.warn(`[wallet] ${message}`)
    })
    try {
      await candidateWalletService.initialize()
      host.state.service = candidateWalletService
      host.state.broker = new WalletBroker(candidateWalletService, {
        assertAgentAccess: () => {
          if (!host.commercialLicenseStore()) throw new Error('License storage is unavailable')
          host.commercialLicenseStore()!.assertAutomationAccess()
        },
        onPendingChanged: (requests) => host.sendToMainWindow('wallets:requests-changed', requests),
        onProviderEvent: (tabId, event) => host.tabs()?.sendWalletProviderEvent(tabId, event)
      })
    } catch (error) {
      candidateWalletService.dispose()
      host.state.service = null
      host.state.broker = null
      host.state.unavailableStatus = walletStartupFailureStatus(error)
      console.error(`[wallet] Wallet startup disabled (${host.state.unavailableStatus.backend}).`)
    }
  }

  function assertWalletPageSender(event: Electron.IpcMainInvokeEvent) {
    if (host.workspaceStartupFailure()) throw host.workspaceStartupFailure()
    if (!host.tabs()) throw new Error('Wallet requests are unavailable before browser initialization')
    return walletBrokerContextFromIpc(event, host.tabs()!)
  }

  function requireWalletService(): WalletService {
    if (!host.state.service) throw new Error('Wallet service is unavailable')
    return host.state.service
  }

  function currentWalletServiceStatus() {
    return host.state.service?.status() ?? structuredClone(host.state.unavailableStatus)
  }

  function requireWalletBroker(): WalletBroker {
    if (!host.state.broker) throw new Error('Wallet broker is unavailable')
    return host.state.broker
  }

  function walletAgentContext(target: WalletAgentToolTarget): WalletBrokerContext {
    if (!host.tabs()) throw new Error('Wallet requests are unavailable before browser initialization')
    const page = host.tabs()!.walletPageContextForMcpTab(target.workspaceId, target.tabId)
    return {
      workspaceId: page.workspaceId,
      tabId: page.tabId,
      navigationGeneration: page.navigationGeneration,
      topLevelOrigin: page.topLevelOrigin,
      requester: {
        type: 'agent',
        id: target.client.id,
        name: target.client.version ? `${target.client.name} ${target.client.version}` : target.client.name
      },
      ...(target.signal ? { signal: target.signal } : {})
    }
  }

  async function generateWallet(input: WalletCreateInput): Promise<WalletDescriptor> {
    const service = requireWalletService()
    const owner = host.mainWindowRefs.window
    if (!owner || owner.isDestroyed()) throw new Error('The Hronaut window is unavailable')
    return generateWalletWithRecoveryConfirmation(service, input, async (recoveryMaterial) => {
      if (owner.isDestroyed()) throw new Error('The Hronaut window is unavailable')
      const { response } = await dialog.showMessageBox(owner, {
        type: 'warning',
        title: host.text('native.dialog.walletRecoveryTitle'),
        message: host.text('native.dialog.walletRecoveryMessage'),
        // The phrase is joined here rather than passed to text(), so it never enters the message catalog's lookup.
        detail: `${recoveryMaterial}\n\n${host.text('native.dialog.walletRecoveryWarning')}`,
        buttons: [host.text('native.dialog.walletRecoverySaved'), host.text('native.dialog.walletRecoveryNotYet')],
        defaultId: 1,
        cancelId: 1,
        noLink: true
      })
      return response === 0
    })
  }

  /** Agents' wallet operations, each admitted through the broker for the agent's page. */
  const agentWallets: WalletAgentOperations = {
    list: async (target) => requireWalletBroker().listAgentWallets(walletAgentContext(target)),
    balance: async (target, walletId, token, spender) => requireWalletBroker().agentBalance(walletAgentContext(target), walletId, token, spender),
    prepareTransaction: async (target, walletId, transaction) => (
      requireWalletBroker().prepareAgentTransaction(walletAgentContext(target), walletId, transaction)
    ),
    requestTransaction: async (target, walletId, transaction, broadcast) => (
      requireWalletBroker().requestAgentTransaction(walletAgentContext(target), walletId, transaction, broadcast)
    ),
    requestMessage: async (target, walletId, message) => (
      requireWalletBroker().requestAgentMessage(walletAgentContext(target), walletId, message)
    ),
    requestStatus: async (target, requestId) => (
      requireWalletBroker().agentRequestStatus(walletAgentContext(target), requestId)
    ),
    pageRequests: async (target) => requireWalletBroker().agentPageRequests(walletAgentContext(target)),
    cancelRequest: async (target, requestId) => (
      requireWalletBroker().cancelAgentRequest(walletAgentContext(target), requestId)
    ),
    cancelRequester: async (requesterId) => requireWalletBroker().cancelForRequester(requesterId)
  }

  return {
    startWallets,
    assertWalletPageSender,
    currentWalletServiceStatus,
    generateWallet,
    agentWallets
  }
}
