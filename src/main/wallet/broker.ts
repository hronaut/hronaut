import { reconcileAccountProviderSessions, type AccountProviderSession, type SolanaTronProviderAccess } from './solana-tron-provider.js'
import type {
  WalletAgentDescriptor,
  WalletChainFamily,
  WalletDescriptor,
  WalletOperation,
  WalletPolicy,
  WalletProviderEvent,
  WalletProviderRequest,
  WalletRequester,
  WalletRequestSummary,
  WalletServiceStatus,
  WalletUpdateInput
} from '../../shared/wallet.js'
import { walletAllowsWorkspace } from '../../shared/wallet.js'
import type { WalletMessageSigningInput } from './accounts.js'
import type { WalletApprovalRecord } from './approvals.js'
import { EvmWalletAdapter } from './adapters/evm.js'
import { EvmCallBundleStore } from './evm-call-bundles.js'
import { EvmFilterRegistry } from './evm-filters.js'
import { EvmAssetSuggestionLog } from './evm-watch-asset.js'
import { WalletPageLog } from './page-log.js'
import { reconcileEvmProviderSessions, uninstallEvmFilters, type EvmProviderAccess, type EvmProviderSession } from './evm-provider.js'
import { SolanaWalletAdapter } from './adapters/solana.js'
import { TronWalletAdapter } from './adapters/tron.js'
import type { WalletChainAdapter, WalletNormalizedTransaction } from './adapters/types.js'
import { WalletPolicyEngine, type WalletPolicyDecision, type WalletWebsiteSignInEvaluation } from './policy.js'
import type { WalletService } from './service.js'
import { drainConfirmationTasks, resumeSubmittedConfirmations, type TransactionConfirmationAccess } from './transaction-confirmations.js'
import {
  agentBalance,
  agentPageRequests,
  agentRequestStatus,
  cancelAgentRequest,
  listAgentWallets,
  prepareAgentTransaction,
  requestAgentMessage,
  requestAgentTransaction,
  type AgentWalletAccess
} from './agent-wallet-requests.js'
import { listPending, type PendingRequestsAccess } from './broker/pending-requests.js'
import { keepsTabAwake, providerRequest, type ProviderRequestsAccess } from './broker/provider-requests.js'
import { approve, reject, type HumanApprovalsAccess } from './broker/human-approvals.js'
import { assertRecordPageActive, assertRequestContextActive, cancelForNavigation, cancelForTab, cancelForWorkspace, isRequestContextActive, resumeTab, type PageLifecycleAccess } from './broker/page-lifecycle.js'
import { assertAgentOperationActive, cancelForRequester, isAgentOperationActive, withAgentOperation, type AgentOperationsAccess } from './broker/agent-operations.js'
import { clearRequestExpiry, createRequest, fail, wait, type RequestRecordsAccess } from './broker/request-records.js'
import { execute, type RequestExecutionAccess } from './broker/request-execution.js'
import { approveWebsiteSignIn, websiteSignInDecision, type WebsiteSignInAccess } from './broker/website-sign-in.js'
import { connect, createAddressPermissionRequest, disconnectWallet, type AccountConnectionsAccess } from './broker/account-connections.js'
import { transactionRequest, type TransactionRequestsAccess } from './broker/transaction-requests.js'
import { messageRequest, type MessageRequestsAccess } from './broker/message-requests.js'
import { removePolicy, removeWallet, revokePermission, setPolicy, updateWallet, type WalletManagementAccess } from './broker/wallet-management.js'
import { sanitizedError } from './broker/sanitized-error.js'

export interface WalletBrokerContext {
  workspaceId: string
  tabId: string
  navigationGeneration: number
  topLevelOrigin: string
  requester: WalletRequester
  signal?: AbortSignal
}

export interface PendingResult {
  resolve(value: unknown): void
  reject(error: Error): void
}

export interface AgentOperationLifecycle {
  activeOperations: number
  cancelled: boolean
  drainWaiters: Array<() => void>
}

export interface WalletBrokerOptions {
  assertAgentAccess?: () => void
  adapters?: Partial<Record<WalletChainFamily, WalletChainAdapter>>
  now?: () => Date
  requestTtlMs?: number
  requestExpiryScheduler?: (callback: () => void, delay: number) => () => void
  permissionExpiryScheduler?: (callback: () => void, delay: number) => () => void
  confirmationPollIntervalMs?: number
  shutdownDrainTimeoutMs?: number
  onPendingChanged?: (requests: WalletRequestSummary[]) => void
  onProviderEvent?: (tabId: string, event: WalletProviderEvent) => void
}

/** Failed wallet calls remembered per tab for `wallet_page_requests`; the oldest is dropped first. */
const MAX_PAGE_CALL_FAILURES_PER_TAB = 20
/** Tabs whose failed wallet calls are remembered at once; closing a tab forgets them sooner. */
const MAX_PAGE_CALL_FAILURE_TABS = 256

/** A wallet call a page made that failed, as an agent testing the page sees it. */
export interface WalletPageCallFailure {
  family: WalletChainFamily
  /** The method the page called, or `invalid` when it is not a plain method name. */
  method: string
  /** The error the page received, which never holds request parameters or the RPC URL. */
  error: string
  failedAt: string
}

const DEFAULT_CONFIRMATION_POLL_INTERVAL_MS = 5_000
const MAX_TIMEOUT_MS = 2_147_483_647

export class WalletBroker {
  private readonly adapters: Record<WalletChainFamily, WalletChainAdapter>
  private readonly policy = new WalletPolicyEngine()
  private readonly pending = new Map<string, PendingResult>()
  private readonly pendingConnections = new Map<string, Promise<unknown>>()
  private readonly pendingMessages = new Map<string, WalletMessageSigningInput>()
  private readonly requestExpiryCancellations = new Map<string, () => void>()
  private permissionExpiryCancellation: (() => void) | null = null
  private readonly confirmationTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly confirmationInFlight = new Set<string>()
  /** Consecutive checks on which a submitted EVM transaction looked replaced by another one with its nonce. */
  private readonly replacedChecks = new Map<string, { since: number; last: number; count: number }>()
  /** Lowercase hashes of sent EVM transactions that failed because another transaction replaced them. */
  private readonly replacedTransactionHashes = new Set<string>()
  private readonly confirmationTasks = new Set<Promise<void>>()
  private readonly agentOperations = new Map<string, AgentOperationLifecycle>()
  private readonly evmProviderSessions = new Map<string, EvmProviderSession>()
  private readonly evmFilters = new EvmFilterRegistry((owner, ids) => uninstallEvmFilters(this.evmProviderAccess(), owner.wallet, ids))
  private readonly evmCallBundles = new EvmCallBundleStore()
  private readonly evmAssetSuggestions = new EvmAssetSuggestionLog()
  private readonly pageCallFailures = new WalletPageLog<WalletPageCallFailure>(MAX_PAGE_CALL_FAILURES_PER_TAB, MAX_PAGE_CALL_FAILURE_TABS)
  private readonly accountProviderSessions = new Map<string, AccountProviderSession>()
  private readonly minimumNavigationGeneration = new Map<string, number>()
  /** Website wallet calls still in progress, other than node reads, counted per tab. */
  private readonly pageCallsInProgress = new Map<string, number>()
  private readonly closedTabs = new Set<string>()
  private readonly confirmationShutdown = new AbortController()
  private lifecycleQueue: Promise<void> = Promise.resolve()
  private lockGeneration = 0
  private shutdownPromise: Promise<void> | null = null
  private shuttingDown = false

  constructor(private readonly service: WalletService, private readonly options: WalletBrokerOptions = {}) {
    this.adapters = {
      evm: options.adapters?.evm ?? new EvmWalletAdapter(),
      solana: options.adapters?.solana ?? new SolanaWalletAdapter(),
      tron: options.adapters?.tron ?? new TronWalletAdapter()
    }
    resumeSubmittedConfirmations(this.transactionConfirmationAccess())
  }

  shutdown(): Promise<void> {
    if (this.shutdownPromise) return this.shutdownPromise
    this.shuttingDown = true
    for (const timer of this.confirmationTimers.values()) clearTimeout(timer)
    this.confirmationTimers.clear()
    for (const cancel of this.requestExpiryCancellations.values()) cancel()
    this.requestExpiryCancellations.clear()
    this.permissionExpiryCancellation?.()
    this.permissionExpiryCancellation = null

    this.shutdownPromise = (async () => {
      await this.lifecycleQueue
      try {
        await this.service.approvals.cancelAll()
      } finally {
        for (const requestId of [...this.pending.keys()]) {
          this.rejectPending(requestId, new Error('Wallet broker is shutting down'))
        }
        const drained = await drainConfirmationTasks(this.transactionConfirmationAccess())
        if (!drained) {
          this.confirmationShutdown.abort()
          while (this.confirmationTasks.size > 0) {
            await Promise.allSettled([...this.confirmationTasks])
          }
        }
        for (const cancel of this.requestExpiryCancellations.values()) cancel()
        this.requestExpiryCancellations.clear()
        for (const requestId of [...this.pendingMessages.keys()]) this.clearPendingMessage(requestId)
        this.evmProviderSessions.clear()
        this.accountProviderSessions.clear()
        this.publish()
      }
    })()
    return this.shutdownPromise
  }

  lock(): Promise<WalletServiceStatus> {
    this.lockGeneration += 1
    this.service.lock()
    reconcileEvmProviderSessions(this.evmProviderAccess())
    return this.queueLifecycle(async () => {
      try {
        await this.service.approvals.cancelAll()
      } finally {
        this.rejectCancelled()
      }
      return this.service.status()
    })
  }

  /** The narrow view the wallet prompt's request list gets of this broker's retained messages. */
  private pendingRequestsAccess(): PendingRequestsAccess {
    return {
      service: this.service,
      pendingMessages: this.pendingMessages
    }
  }

  listPending(): WalletRequestSummary[] {
    return listPending(this.pendingRequestsAccess())
  }

  /** The narrow view wallet management gets of this broker's lifecycle queue and page connections. */
  private walletManagementAccess(): WalletManagementAccess {
    return {
      service: this.service,
      queueLifecycle: (operation) => this.queueLifecycle(operation),
      reconcileProviderSessions: () => this.reconcileProviderSessions(),
      rejectCancelled: () => this.rejectCancelled(),
      now: () => this.now()
    }
  }

  updateWallet(walletId: string, changes: WalletUpdateInput): Promise<WalletDescriptor> {
    return updateWallet(this.walletManagementAccess(), walletId, changes)
  }

  setPolicy(input: WalletPolicy): Promise<WalletPolicy> {
    return setPolicy(this.walletManagementAccess(), input)
  }

  removePolicy(policyId: string): Promise<boolean> {
    return removePolicy(this.walletManagementAccess(), policyId)
  }

  removeWallet(walletId: string): Promise<boolean> {
    return removeWallet(this.walletManagementAccess(), walletId)
  }

  revokePermission(permissionId: string): Promise<boolean> {
    return revokePermission(this.walletManagementAccess(), permissionId)
  }

  /**
   * The narrow view the agent wallet tools get of this broker's private
   * state and request path. The delegates below return the tool's result or
   * promise directly, so no extra ticks separate its final checks from the
   * caller.
   */
  private agentWalletAccess(): AgentWalletAccess {
    return {
      service: this.service,
      adapters: this.adapters,
      pendingMessages: this.pendingMessages,
      evmAssetSuggestions: this.evmAssetSuggestions,
      pageCallFailures: this.pageCallFailures,
      evmCallBundles: this.evmCallBundles,
      replacedTransactionHashes: this.replacedTransactionHashes,
      withAgentOperation: (context, operation) => this.withAgentOperation(context, operation),
      requireAccessibleWallet: (context, walletId) => this.requireAccessibleWallet(context, walletId),
      requireWallet: (walletId) => this.requireWallet(walletId),
      hasAddressPermission: (context, wallet) => this.hasAddressPermission(context, wallet),
      assertRequestContextActive: (context) => this.assertRequestContextActive(context),
      createAddressPermissionRequest: (context, wallet) => this.createAddressPermissionRequest(context, wallet),
      transactionRequest: (context, wallet, payload, broadcast, returnSummary) => (
        this.transactionRequest(context, wallet, payload, broadcast, returnSummary)
      ),
      messageRequest: (context, wallet, input, rawSigning, returnSummary) => (
        this.messageRequest(context, wallet, input, rawSigning, returnSummary)
      ),
      rejectPending: (requestId, error) => this.rejectPending(requestId, error),
      publish: () => this.publish(),
      now: () => this.now()
    }
  }

  listAgentWallets(context: WalletBrokerContext): WalletAgentDescriptor[] {
    return listAgentWallets(this.agentWalletAccess(), context)
  }

  agentBalance(context: WalletBrokerContext, walletId: string, token?: string, spender?: string): Promise<Record<string, unknown>> {
    return agentBalance(this.agentWalletAccess(), context, walletId, token, spender)
  }

  prepareAgentTransaction(context: WalletBrokerContext, walletId: string, payload: unknown): Promise<Record<string, unknown>> {
    return prepareAgentTransaction(this.agentWalletAccess(), context, walletId, payload)
  }

  requestAgentTransaction(context: WalletBrokerContext, walletId: string, payload: unknown, broadcast: boolean): Promise<Record<string, unknown>> {
    return requestAgentTransaction(this.agentWalletAccess(), context, walletId, payload, broadcast)
  }

  requestAgentMessage(context: WalletBrokerContext, walletId: string, message: Uint8Array): Promise<Record<string, unknown>> {
    return requestAgentMessage(this.agentWalletAccess(), context, walletId, message)
  }

  agentRequestStatus(context: WalletBrokerContext, requestId: string): Record<string, unknown> {
    return agentRequestStatus(this.agentWalletAccess(), context, requestId)
  }

  agentPageRequests(context: WalletBrokerContext): Record<string, unknown> {
    return agentPageRequests(this.agentWalletAccess(), context)
  }

  cancelAgentRequest(context: WalletBrokerContext, requestId: string): Promise<Record<string, unknown>> {
    return cancelAgentRequest(this.agentWalletAccess(), context, requestId)
  }

  /** The narrow view page wallet calls get of this broker's state, built on each call so shutdown reads stay live. */
  private providerRequestsAccess(): ProviderRequestsAccess {
    return {
      service: this.service,
      pageCallsInProgress: this.pageCallsInProgress,
      pageCallFailures: this.pageCallFailures,
      isShuttingDown: () => this.shuttingDown,
      isRequestContextActive: (context) => this.isRequestContextActive(context),
      assertRequestContextActive: (context) => this.assertRequestContextActive(context),
      accessibleWallets: (context, family) => this.accessibleWallets(context, family),
      evmProviderAccess: () => this.evmProviderAccess(),
      solanaTronProviderAccess: () => this.solanaTronProviderAccess(),
      now: () => this.now()
    }
  }

  providerRequest(context: WalletBrokerContext, input: WalletProviderRequest): Promise<unknown> {
    return providerRequest(this.providerRequestsAccess(), context, input)
  }

  keepsTabAwake(tabId: string): boolean {
    return keepsTabAwake(this.providerRequestsAccess(), tabId)
  }

  /** The narrow view prompt approvals get of this broker's state, built on each call so lock generation reads stay live. */
  private humanApprovalsAccess(): HumanApprovalsAccess {
    return {
      service: this.service,
      pending: this.pending,
      lockGeneration: () => this.lockGeneration,
      queueLifecycle: (operation) => this.queueLifecycle(operation),
      execute: (record) => this.execute(record),
      fail: (requestId, error) => this.fail(requestId, error),
      rejectPending: (requestId, error) => this.rejectPending(requestId, error),
      clearRequestExpiry: (requestId) => this.clearRequestExpiry(requestId),
      requireWallet: (walletId) => this.requireWallet(walletId),
      publish: () => this.publish(),
      now: () => this.now()
    }
  }

  approve(requestId: string): Promise<WalletRequestSummary> {
    return approve(this.humanApprovalsAccess(), requestId)
  }

  reject(requestId: string): Promise<WalletRequestSummary> {
    return reject(this.humanApprovalsAccess(), requestId)
  }

  /** The narrow view page lifecycle handling gets of this broker's state, built on each call so shutdown reads stay live. */
  private pageLifecycleAccess(): PageLifecycleAccess {
    return {
      service: this.service,
      options: this.options,
      minimumNavigationGeneration: this.minimumNavigationGeneration,
      closedTabs: this.closedTabs,
      evmFilters: this.evmFilters,
      evmCallBundles: this.evmCallBundles,
      evmAssetSuggestions: this.evmAssetSuggestions,
      pageCallFailures: this.pageCallFailures,
      isShuttingDown: () => this.shuttingDown,
      clearEvmProviderSessions: (predicate) => this.clearEvmProviderSessions(predicate),
      clearAccountProviderSessions: (predicate) => this.clearAccountProviderSessions(predicate),
      isAgentOperationActive: (context) => this.isAgentOperationActive(context),
      assertAgentOperationActive: (context) => this.assertAgentOperationActive(context),
      queueLifecycle: (operation) => this.queueLifecycle(operation),
      rejectCancelled: () => this.rejectCancelled()
    }
  }

  cancelForNavigation(tabId: string, generation: number): Promise<void> {
    return cancelForNavigation(this.pageLifecycleAccess(), tabId, generation)
  }

  cancelForTab(tabId: string): Promise<void> {
    return cancelForTab(this.pageLifecycleAccess(), tabId)
  }

  resumeTab(tabId: string, navigationGeneration: number): Promise<void> {
    return resumeTab(this.pageLifecycleAccess(), tabId, navigationGeneration)
  }

  cancelForWorkspace(workspaceId: string): Promise<void> {
    return cancelForWorkspace(this.pageLifecycleAccess(), workspaceId)
  }

  private isRequestContextActive(context: WalletBrokerContext): boolean {
    return isRequestContextActive(this.pageLifecycleAccess(), context)
  }

  private assertRequestContextActive(context: WalletBrokerContext): void {
    assertRequestContextActive(this.pageLifecycleAccess(), context)
  }

  private assertRecordPageActive(record: WalletApprovalRecord): void {
    assertRecordPageActive(this.pageLifecycleAccess(), record)
  }

  /** The narrow view agent operation tracking gets of this broker's state, built on each call so shutdown reads stay live. */
  private agentOperationsAccess(): AgentOperationsAccess {
    return {
      service: this.service,
      options: this.options,
      agentOperations: this.agentOperations,
      isShuttingDown: () => this.shuttingDown,
      isRequestContextActive: (context) => this.isRequestContextActive(context),
      clearEvmProviderSessions: (predicate) => this.clearEvmProviderSessions(predicate),
      clearAccountProviderSessions: (predicate) => this.clearAccountProviderSessions(predicate),
      queueLifecycle: (operation) => this.queueLifecycle(operation),
      rejectCancelled: () => this.rejectCancelled()
    }
  }

  cancelForRequester(requesterId: string): Promise<void> {
    return cancelForRequester(this.agentOperationsAccess(), requesterId)
  }

  private withAgentOperation<T>(context: WalletBrokerContext, operation: () => Promise<T>): Promise<T> {
    return withAgentOperation(this.agentOperationsAccess(), context, operation)
  }

  private isAgentOperationActive(context: WalletBrokerContext): boolean {
    return isAgentOperationActive(this.agentOperationsAccess(), context)
  }

  private assertAgentOperationActive(context: WalletBrokerContext): void {
    assertAgentOperationActive(this.agentOperationsAccess(), context)
  }

  /**
   * The narrow view the EVM page provider gets of this broker's private
   * state and request path. It is built on each call, so it reads whether
   * the broker is shutting down at the moment the provider asks, and the
   * calls below return the provider's promise directly.
   */
  private evmProviderAccess(): EvmProviderAccess {
    return {
      adapters: this.adapters,
      options: this.options,
      evmProviderSessions: this.evmProviderSessions,
      evmFilters: this.evmFilters,
      evmCallBundles: this.evmCallBundles,
      evmAssetSuggestions: this.evmAssetSuggestions,
      closedTabs: this.closedTabs,
      replacedTransactionHashes: this.replacedTransactionHashes,
      isShuttingDown: () => this.shuttingDown,
      accessibleWallets: (context, family) => this.accessibleWallets(context, family),
      selectWallet: (wallets) => this.selectWallet(wallets),
      hasAddressPermission: (context, wallet) => this.hasAddressPermission(context, wallet),
      assertAddressPermission: (context, wallet, capability) => this.assertAddressPermission(context, wallet, capability),
      isRequestContextActive: (context) => this.isRequestContextActive(context),
      assertRequestContextActive: (context) => this.assertRequestContextActive(context),
      scheduleProviderPermissionExpiry: () => this.scheduleProviderPermissionExpiry(),
      confirmationPollIntervalMs: () => this.confirmationPollIntervalMs(),
      connect: (context, wallet) => this.connect(context, wallet),
      disconnectWallet: (context, wallet) => this.disconnectWallet(context, wallet),
      transactionRequest: (context, wallet, payload, broadcast) => this.transactionRequest(context, wallet, payload, broadcast),
      messageRequest: (context, wallet, input, rawSigning) => this.messageRequest(context, wallet, input, rawSigning),
      messageBytes: (value, encoding) => this.messageBytes(value, encoding),
      sanitizedError: (error) => sanitizedError(error),
      now: () => this.now()
    }
  }

  /**
   * The narrow view the Solana and Tron page providers get of this broker's
   * private state and request path. It is built on each call, and the calls
   * below return the provider's promise directly.
   */
  private solanaTronProviderAccess(): SolanaTronProviderAccess {
    return {
      adapters: this.adapters,
      options: this.options,
      accountProviderSessions: this.accountProviderSessions,
      accessibleWallets: (context, family) => this.accessibleWallets(context, family),
      selectWallet: (wallets) => this.selectWallet(wallets),
      hasAddressPermission: (context, wallet) => this.hasAddressPermission(context, wallet),
      assertAddressPermission: (context, wallet, capability) => this.assertAddressPermission(context, wallet, capability),
      assertRequestContextActive: (context) => this.assertRequestContextActive(context),
      scheduleProviderPermissionExpiry: () => this.scheduleProviderPermissionExpiry(),
      connect: (context, wallet) => this.connect(context, wallet),
      disconnectWallet: (context, wallet) => this.disconnectWallet(context, wallet),
      transactionRequest: (context, wallet, payload, broadcast, returnSummary, prepared) => (
        this.transactionRequest(context, wallet, payload, broadcast, returnSummary, prepared)
      ),
      messageRequest: (context, wallet, input) => this.messageRequest(context, wallet, input),
      messageBytes: (value) => this.messageBytes(value)
    }
  }

  refreshProviderSessions(): void {
    this.reconcileProviderSessions()
  }

  private reconcileProviderSessions(): void {
    reconcileEvmProviderSessions(this.evmProviderAccess())
    reconcileAccountProviderSessions(this.solanaTronProviderAccess())
    this.scheduleProviderPermissionExpiry()
  }

  private scheduleProviderPermissionExpiry(): void {
    this.permissionExpiryCancellation?.()
    this.permissionExpiryCancellation = null
    if (this.shuttingDown || (!this.evmProviderSessions.size && !this.accountProviderSessions.size)) return
    const now = this.now().getTime()
    const nextExpiry = this.service.permissions.list().reduce((earliest, permission) => {
      const expiresAt = Date.parse(permission.expiresAt)
      return expiresAt > now && expiresAt < earliest ? expiresAt : earliest
    }, Number.POSITIVE_INFINITY)
    if (!Number.isFinite(nextExpiry)) return
    const reconcile = () => {
      this.permissionExpiryCancellation = null
      if (!this.shuttingDown) this.reconcileProviderSessions()
    }
    const delay = Math.min(MAX_TIMEOUT_MS, Math.max(0, nextExpiry - now))
    this.permissionExpiryCancellation = this.options.permissionExpiryScheduler?.(reconcile, delay) ?? (() => {
      const timer = setTimeout(reconcile, delay)
      timer.unref()
      return () => clearTimeout(timer)
    })()
  }

  private clearEvmProviderSessions(predicate: (session: EvmProviderSession) => boolean): void {
    for (const [key, session] of this.evmProviderSessions) {
      if (predicate(session)) this.evmProviderSessions.delete(key)
    }
  }

  private clearAccountProviderSessions(predicate: (session: AccountProviderSession) => boolean): void {
    for (const [key, session] of this.accountProviderSessions) {
      if (predicate(session)) this.accountProviderSessions.delete(key)
    }
  }

  /** The narrow view account connections get of this broker's private state and request path. */
  private accountConnectionsAccess(): AccountConnectionsAccess {
    return {
      service: this.service,
      options: this.options,
      pendingConnections: this.pendingConnections,
      hasAddressPermission: (context, wallet) => this.hasAddressPermission(context, wallet),
      requireAccessibleWallet: (context, walletId) => this.requireAccessibleWallet(context, walletId),
      createRequest: (context, wallet, operation, capability, payload) => this.createRequest(context, wallet, operation, capability, payload),
      wait: (requestId) => this.wait(requestId),
      fail: (requestId, error) => this.fail(requestId, error),
      websiteSignInDecision: (context, wallet, recordId) => this.websiteSignInDecision(context, wallet, recordId),
      approveWebsiteSignIn: (context, wallet, recordId, policies, policyId) => this.approveWebsiteSignIn(context, wallet, recordId, policies, policyId),
      clearRequestExpiry: (requestId) => this.clearRequestExpiry(requestId),
      clearAccountProviderSessions: (predicate) => this.clearAccountProviderSessions(predicate),
      queueLifecycle: (operation) => this.queueLifecycle(operation),
      rejectCancelled: () => this.rejectCancelled(),
      publish: () => this.publish(),
      now: () => this.now()
    }
  }

  private connect(context: WalletBrokerContext, wallet: WalletDescriptor): Promise<unknown> {
    return connect(this.accountConnectionsAccess(), context, wallet)
  }

  private createAddressPermissionRequest(
    context: WalletBrokerContext,
    wallet: WalletDescriptor,
    allowWebsiteSignIn = false
  ): Promise<{ record: WalletApprovalRecord; approved: false } | { record: WalletApprovalRecord; approved: true; result: unknown }> {
    return createAddressPermissionRequest(this.accountConnectionsAccess(), context, wallet, allowWebsiteSignIn)
  }

  private disconnectWallet(context: WalletBrokerContext, wallet: WalletDescriptor): Promise<void> {
    return disconnectWallet(this.accountConnectionsAccess(), context, wallet)
  }

  /** The narrow view transaction requests get of this broker's policy engine and request path. */
  private transactionRequestsAccess(): TransactionRequestsAccess {
    return {
      service: this.service,
      adapters: this.adapters,
      policy: this.policy,
      assertRequestContextActive: (context) => this.assertRequestContextActive(context),
      requireAccessibleWallet: (context, walletId) => this.requireAccessibleWallet(context, walletId),
      requireWallet: (walletId) => this.requireWallet(walletId),
      assertAddressPermission: (context, wallet, capability) => this.assertAddressPermission(context, wallet, capability),
      createRequest: (context, wallet, operation, capability, payload) => this.createRequest(context, wallet, operation, capability, payload),
      execute: (record, activeAgentContext) => this.execute(record, activeAgentContext),
      wait: (requestId) => this.wait(requestId),
      fail: (requestId, error) => this.fail(requestId, error),
      clearRequestExpiry: (requestId) => this.clearRequestExpiry(requestId),
      queueLifecycle: (operation) => this.queueLifecycle(operation),
      publish: () => this.publish(),
      now: () => this.now()
    }
  }

  private transactionRequest(context: WalletBrokerContext, wallet: WalletDescriptor, payload: unknown, broadcast: boolean, returnSummary = false, prepared?: WalletNormalizedTransaction): Promise<unknown> {
    return transactionRequest(this.transactionRequestsAccess(), context, wallet, payload, broadcast, returnSummary, prepared)
  }

  /** The narrow view message requests get of this broker's retained messages and request path. */
  private messageRequestsAccess(): MessageRequestsAccess {
    return {
      service: this.service,
      pendingMessages: this.pendingMessages,
      requireAccessibleWallet: (context, walletId) => this.requireAccessibleWallet(context, walletId),
      assertAddressPermission: (context, wallet, capability) => this.assertAddressPermission(context, wallet, capability),
      createRequest: (context, wallet, operation, capability, payload) => this.createRequest(context, wallet, operation, capability, payload),
      websiteSignInDecision: (context, wallet, recordId, message) => this.websiteSignInDecision(context, wallet, recordId, message),
      approveWebsiteSignIn: (context, wallet, recordId, policies, policyId, typedData) => this.approveWebsiteSignIn(context, wallet, recordId, policies, policyId, typedData),
      clearRequestExpiry: (requestId) => this.clearRequestExpiry(requestId),
      wait: (requestId) => this.wait(requestId),
      fail: (requestId, error) => this.fail(requestId, error),
      publish: () => this.publish(),
      now: () => this.now()
    }
  }

  private messageRequest(context: WalletBrokerContext, wallet: WalletDescriptor, input: WalletMessageSigningInput, rawSigning = false, returnSummary = false): Promise<unknown> {
    return messageRequest(this.messageRequestsAccess(), context, wallet, input, rawSigning, returnSummary)
  }

  /** The narrow view website sign-in policies get of this broker's policy engine and request path. */
  private websiteSignInAccess(): WebsiteSignInAccess {
    return {
      service: this.service,
      policy: this.policy,
      assertRequestContextActive: (context) => this.assertRequestContextActive(context),
      requireAccessibleWallet: (context, walletId) => this.requireAccessibleWallet(context, walletId),
      execute: (record, activeAgentContext, options) => this.execute(record, activeAgentContext, options),
      queueLifecycle: (operation) => this.queueLifecycle(operation),
      now: () => this.now()
    }
  }

  private websiteSignInDecision(context: WalletBrokerContext, wallet: WalletDescriptor, recordId: string, message?: WalletWebsiteSignInEvaluation['message']): { decision: WalletPolicyDecision; policies: WalletPolicy[] } | undefined {
    return websiteSignInDecision(this.websiteSignInAccess(), context, wallet, recordId, message)
  }

  private approveWebsiteSignIn(context: WalletBrokerContext, wallet: WalletDescriptor, recordId: string, policies: readonly WalletPolicy[], policyId: string, typedData = false): Promise<{ approved: false } | { approved: true; result: unknown }> {
    return approveWebsiteSignIn(this.websiteSignInAccess(), context, wallet, recordId, policies, policyId, typedData)
  }

  /** The narrow view request execution gets of this broker's retained messages, page checks and signing path. */
  private requestExecutionAccess(): RequestExecutionAccess {
    return {
      service: this.service,
      adapters: this.adapters,
      pendingMessages: this.pendingMessages,
      assertRecordPageActive: (record) => this.assertRecordPageActive(record),
      assertRequestContextActive: (context) => this.assertRequestContextActive(context),
      requireWallet: (walletId) => this.requireWallet(walletId),
      evmProviderAccess: () => this.evmProviderAccess(),
      scheduleProviderPermissionExpiry: () => this.scheduleProviderPermissionExpiry(),
      clearPendingMessage: (requestId) => this.clearPendingMessage(requestId),
      transactionConfirmationAccess: () => this.transactionConfirmationAccess(),
      now: () => this.now()
    }
  }

  private execute(record: WalletApprovalRecord, activeAgentContext?: WalletBrokerContext, options: { permissionNotAfter?: string } = {}): Promise<unknown> {
    return execute(this.requestExecutionAccess(), record, activeAgentContext, options)
  }

  /** The narrow view request records get of this broker's waiting page promises and expiry timers. */
  private requestRecordsAccess(): RequestRecordsAccess {
    return {
      service: this.service,
      options: this.options,
      pending: this.pending,
      requestExpiryCancellations: this.requestExpiryCancellations,
      assertRequestContextActive: (context) => this.assertRequestContextActive(context),
      isRequestContextActive: (context) => this.isRequestContextActive(context),
      assertAgentOperationActive: (context) => this.assertAgentOperationActive(context),
      rejectCancelled: () => this.rejectCancelled(),
      rejectPending: (requestId, error) => this.rejectPending(requestId, error),
      queueLifecycle: (operation) => this.queueLifecycle(operation),
      publish: () => this.publish(),
      now: () => this.now()
    }
  }

  private createRequest(context: WalletBrokerContext, wallet: WalletDescriptor, operation: WalletOperation, capability: 'read' | 'sign' | 'send', payload: Record<string, unknown>): Promise<WalletApprovalRecord> {
    return createRequest(this.requestRecordsAccess(), context, wallet, operation, capability, payload)
  }

  private wait(requestId: string): Promise<unknown> {
    return wait(this.requestRecordsAccess(), requestId)
  }

  private fail(requestId: string, error: unknown): Promise<Error> {
    return fail(this.requestRecordsAccess(), requestId, error)
  }

  private clearRequestExpiry(requestId: string): void {
    clearRequestExpiry(this.requestRecordsAccess(), requestId)
  }

  /**
   * The narrow view transaction confirmation tracking gets of this broker's
   * private state. It is built on each call, so it reads whether the broker
   * is shutting down at the moment a check asks.
   */
  private transactionConfirmationAccess(): TransactionConfirmationAccess {
    return {
      service: this.service,
      adapters: this.adapters,
      options: this.options,
      confirmationTimers: this.confirmationTimers,
      confirmationInFlight: this.confirmationInFlight,
      replacedChecks: this.replacedChecks,
      replacedTransactionHashes: this.replacedTransactionHashes,
      confirmationTasks: this.confirmationTasks,
      confirmationShutdown: this.confirmationShutdown,
      isShuttingDown: () => this.shuttingDown,
      confirmationPollIntervalMs: () => this.confirmationPollIntervalMs(),
      publish: () => this.publish(),
      now: () => this.now()
    }
  }

  private confirmationPollIntervalMs(): number {
    const value = this.options.confirmationPollIntervalMs ?? DEFAULT_CONFIRMATION_POLL_INTERVAL_MS
    return Number.isSafeInteger(value) && value > 0 ? value : DEFAULT_CONFIRMATION_POLL_INTERVAL_MS
  }

  private accessibleWallets(context: WalletBrokerContext, family: WalletChainFamily): WalletDescriptor[] {
    return this.service.list().filter((wallet) => wallet.chainFamily === family && walletAllowsWorkspace(wallet, context.workspaceId))
  }

  private requireAccessibleWallet(context: WalletBrokerContext, walletId: string): WalletDescriptor {
    const wallet = this.requireWallet(walletId)
    if (!walletAllowsWorkspace(wallet, context.workspaceId)) {
      throw new Error('Wallet is not attached to the requesting workspace')
    }
    return wallet
  }

  private requireWallet(walletId: string): WalletDescriptor {
    const wallet = this.service.list().find((entry) => entry.id === walletId)
    if (!wallet) throw new Error('Wallet not found')
    return wallet
  }

  private selectWallet(wallets: WalletDescriptor[]): WalletDescriptor {
    const wallet = wallets.find((entry) => entry.kind !== 'watch-only') ?? wallets[0]
    if (!wallet) throw new Error('No wallet is attached to this workspace for the requested chain')
    return wallet
  }

  private hasAddressPermission(context: WalletBrokerContext, wallet: WalletDescriptor): boolean {
    return this.service.permissions.allows({
      walletId: wallet.id, workspaceId: context.workspaceId, origin: context.topLevelOrigin,
      account: wallet.publicAddress, chainFamily: wallet.chainFamily, networkId: wallet.network.id,
      requester: context.requester, capability: 'read'
    }, this.now())
  }

  private assertAddressPermission(context: WalletBrokerContext, wallet: WalletDescriptor, capability: 'sign' | 'send'): void {
    if (!this.service.permissions.allows({
      walletId: wallet.id, workspaceId: context.workspaceId, origin: context.topLevelOrigin,
      account: wallet.publicAddress, chainFamily: wallet.chainFamily, networkId: wallet.network.id,
      requester: context.requester, capability: 'read'
    }, this.now())) throw new Error(`Wallet account access must be approved before ${capability}`)
  }

  private messageBytes(value: unknown, encoding: 'utf8' | 'hex-or-utf8' = 'utf8'): Uint8Array {
    if (value instanceof Uint8Array) {
      if (!value.length || value.length > 1_048_576) throw new Error('Wallet message is invalid')
      return Uint8Array.from(value)
    }
    if (typeof value !== 'string' || !value.length) throw new Error('Wallet message is invalid')
    if (encoding === 'hex-or-utf8' && /^0x(?:[a-fA-F0-9]{2})+$/.test(value)) return Buffer.from(value.slice(2), 'hex')
    const bytes = Buffer.from(value, 'utf8')
    if (bytes.length > 1_048_576) throw new Error('Wallet message is invalid')
    return bytes
  }

  private rejectCancelled(): void {
    for (const record of this.service.approvals.list()) {
      if (record.status !== 'cancelled' && record.status !== 'expired') continue
      this.rejectPending(record.id, new Error(`Wallet request was ${record.status}`))
    }
    this.publish()
  }

  private rejectPending(requestId: string, error: Error): void {
    this.pending.get(requestId)?.reject(error)
    this.pending.delete(requestId)
    this.clearPendingMessage(requestId)
    this.clearRequestExpiry(requestId)
  }

  private clearPendingMessage(requestId: string): void {
    const input = this.pendingMessages.get(requestId)
    if (input?.kind === 'message') input.message.fill(0)
    this.pendingMessages.delete(requestId)
  }

  private publish(): void {
    this.options.onPendingChanged?.(this.listPending())
  }

  private queueLifecycle<T>(operation: () => Promise<T>): Promise<T> {
    if (this.shuttingDown) return Promise.reject(new Error('Wallet broker is shutting down'))
    const result = this.lifecycleQueue.then(operation)
    this.lifecycleQueue = result.then(() => undefined, () => undefined)
    return result
  }

  private now(): Date {
    return this.options.now?.() ?? new Date()
  }
}
