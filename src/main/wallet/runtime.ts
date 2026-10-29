import { app, safeStorage, type BrowserWindow, type IpcMainInvokeEvent, type MessageBoxReturnValue } from 'electron'
import { join } from 'node:path'
import { WalletBroker, type WalletBrokerContext } from './broker.js'
import { walletBrokerContextFromIpc } from './ipc-context.js'
import type { WalletSafeStorage } from './key-provider.js'
import { generateWalletWithRecoveryConfirmation } from './onboarding.js'
import { WalletService } from './service.js'
import { walletStartupFailureStatus } from './startup-status.js'
import type { Browser } from '../browser/browser.js'
import type { CommercialLicenseStore } from '../license/commercial-license-store.js'
import type { WalletAgentOperations, WalletAgentToolTarget } from '../mcp/server.js'
import type { MainWindowRefs } from '../windows/main-window.js'
import type { TrustedDialogOptions } from '../trusted-dialogs/trusted-dialogs.js'
import { LocalizedError } from '../localized-error.js'
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
  tabs(): Pick<Browser, 'walletPageContext' | 'walletPageContextForMcpTab' | 'sendWalletProviderEvent'> | null
  /** Why saved workspaces could not start, if they could not; read on every page request. */
  workspaceStartupFailure(): Error | undefined
  /** The main window, which shows the recovery phrase dialog; read on every use because it can close. */
  mainWindowRefs: Pick<MainWindowRefs, 'window'>
  /** Asks in Hronaut's own dialog on a shell window, or the system dialog when none can show it. */
  showDialog(options: TrustedDialogOptions<BrowserWindow>): Promise<MessageBoxReturnValue>
  /** A message in the interface language, for the recovery phrase dialog. */
  text(key: MessageKey, parameters?: MessageParameters): string
}

/**
 * Wallets at runtime: starting the wallet service and its broker, which stay off with a reported reason when the
 * wallet data cannot be opened, admitting wallet requests from pages and agents for the page they came from, and
 * generating a wallet only after the person confirms in Hronaut's own dialog that they saved its recovery phrase. The
 * phrase is shown only in that dialog, which the main window's trusted shell draws over its pages, or in the system
 * dialog when the window cannot show it; no website, log or agent gets it. `agentWallets` is what the MCP server
 * offers agents.
 */
export function createWalletRuntime(host: WalletRuntimeHost): {
  startWallets(): Promise<void>
  assertWalletPageSender(event: IpcMainInvokeEvent): WalletBrokerContext
  currentWalletServiceStatus(): WalletServiceStatus
  generateWallet(input: WalletCreateInput): Promise<WalletDescriptor>
  agentWallets: WalletAgentOperations
} {
  /**
   * Starts the wallet service and its broker, and tells the main window their status and wallets once they did or
   * could not. Opening a vault waits for the operating system's secure storage, which can take as long as the person
   * takes to unlock it, so startup does not wait for this. It never fails.
   */
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
    host.sendToMainWindow('wallets:status-changed', currentWalletServiceStatus())
    host.sendToMainWindow('wallets:changed', host.state.service?.list() ?? [])
  }

  function assertWalletPageSender(event: Electron.IpcMainInvokeEvent) {
    if (host.workspaceStartupFailure()) throw host.workspaceStartupFailure()
    if (!host.tabs()) throw new Error('Wallet requests are unavailable before browser initialization')
    return walletBrokerContextFromIpc(event, host.tabs()!)
  }

  function requireWalletService(): WalletService {
    if (!host.state.service) throw new LocalizedError('appErrors.wallet.serviceUnavailable')
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

  /** How many recovery phrases each window shows or holds now, and whether Hronaut turned its capture protection on. */
  const recoveryPhrasesShown = new WeakMap<BrowserWindow, { count: number, protectedByHronaut: boolean }>()
  /**
   * How long the protection outlasts the answer: main resolves the dialog as it tells the shell to close it, and the
   * shell draws the window without the phrase only a few frames later.
   */
  const RECOVERY_PROTECTION_LINGER_MS = 1000

  /**
   * Keeps the window out of screen recordings and screen sharing while a recovery phrase is on it, where the system
   * supports it, until a moment after the last phrase it shows is answered; a window protected before stays protected.
   */
  function protectWhileRecoveryShown(owner: BrowserWindow): () => void {
    let shown = recoveryPhrasesShown.get(owner)
    if (!shown) {
      shown = { count: 0, protectedByHronaut: false }
      recoveryPhrasesShown.set(owner, shown)
    }
    if (shown.count === 0 && !owner.isContentProtected()) {
      owner.setContentProtection(true)
      shown.protectedByHronaut = true
    }
    shown.count += 1
    const entry = shown
    return () => {
      entry.count -= 1
      setTimeout(() => {
        // Another phrase shown meanwhile keeps the protection until it is answered too.
        if (entry.count > 0 || !entry.protectedByHronaut) return
        entry.protectedByHronaut = false
        if (!owner.isDestroyed()) owner.setContentProtection(false)
      }, RECOVERY_PROTECTION_LINGER_MS)
    }
  }

  async function generateWallet(input: WalletCreateInput): Promise<WalletDescriptor> {
    const service = requireWalletService()
    const owner = host.mainWindowRefs.window
    if (!owner || owner.isDestroyed()) throw new LocalizedError('appErrors.wallet.windowUnavailable')
    return generateWalletWithRecoveryConfirmation(service, input, async (recoveryMaterial, wallet) => {
      if (owner.isDestroyed()) throw new Error('The Hronaut window is unavailable')
      const unprotect = protectWhileRecoveryShown(owner)
      try {
        const { response } = await host.showDialog({
          type: 'warning',
          title: host.text('native.dialog.walletRecoveryTitle'),
          message: host.text('native.dialog.walletRecoveryMessage'),
          // The phrase is joined here rather than passed to text(), so it never enters the message catalog's lookup.
          detail: `${recoveryMaterial}\n\n${host.text('native.dialog.walletRecoveryWarning')}`,
          buttons: [host.text('native.dialog.walletRecoverySaved'), host.text('native.dialog.walletRecoveryNotYet')],
          defaultId: 1,
          cancelId: 1,
          primaryId: 0,
          noLink: true,
          window: owner,
          variant: { kind: 'wallet-recovery', walletName: wallet.name, words: recoveryMaterial.trim().split(/\s+/u) }
        })
        return response === 0
      } finally {
        unprotect()
      }
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
