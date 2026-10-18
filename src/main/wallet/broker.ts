import { createHash, randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import {
  reconcileAccountProviderSessions,
  solanaRequest,
  tronRequest,
  type AccountProviderSession,
  type SolanaTronProviderAccess
} from './solana-tron-provider.js'
import type {
  WalletAgentDescriptor,
  WalletChainFamily,
  WalletDescriptor,
  WalletOperation,
  WalletOperationRequest,
  WalletPolicy,
  WalletProviderEvent,
  WalletProviderRequest,
  WalletRequester,
  WalletRequestSummary,
  WalletServiceStatus,
  WalletUpdateInput
} from '../../shared/wallet.js'
import {
  EVM_FILTER_RPC_METHODS,
  EVM_READ_RPC_METHODS,
  WALLET_PROVIDER_METHODS,
  WalletProviderRequestSchema,
  WalletUpdateInputSchema,
  walletAllowsWorkspace
} from '../../shared/wallet.js'
import { signWalletPayload, type WalletMessageSigningInput } from './accounts.js'
import type { WalletApprovalRecord } from './approvals.js'
import { EvmWalletAdapter } from './adapters/evm.js'
import { EvmCallBundleStore } from './evm-call-bundles.js'
import { EvmFilterRegistry } from './evm-filters.js'
import { EvmAssetSuggestionLog } from './evm-watch-asset.js'
import { WalletPageLog } from './page-log.js'
import { typedDataDisplay } from './typed-data-display.js'
import {
  evmRequest,
  reconcileEvmProviderSessions,
  uninstallEvmFilters,
  type EvmProviderAccess,
  type EvmProviderSession
} from './evm-provider.js'
import { SolanaWalletAdapter } from './adapters/solana.js'
import { TronWalletAdapter } from './adapters/tron.js'
import type {
  WalletChainAdapter,
  WalletNormalizedTransaction
} from './adapters/types.js'
import { restoreWalletJson, walletJsonSafe } from './json-safe.js'
import {
  isMainnetAgentAutomationPolicy,
  websiteSignInPolicyApplies,
  websiteTypedDataPolicyApplies,
  WalletPolicyEngine,
  type WalletPolicyDecision,
  type WalletWebsiteSignInEvaluation
} from './policy.js'
import type { WalletService } from './service.js'
import {
  agentSummary,
  sanitizedSimulation,
  summary,
  trustedMessageDisplay,
  trustedMessageRaw
} from './request-summary.js'
import {
  appendTransactionAudit,
  drainConfirmationTasks,
  resumeSubmittedConfirmations,
  scheduleConfirmation,
  type TransactionConfirmationAccess
} from './transaction-confirmations.js'
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

export interface WalletBrokerContext {
  workspaceId: string
  tabId: string
  navigationGeneration: number
  topLevelOrigin: string
  requester: WalletRequester
  signal?: AbortSignal
}

interface PendingResult {
  resolve(value: unknown): void
  reject(error: Error): void
}

interface AgentOperationLifecycle {
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

const DEFAULT_REQUEST_TTL_MS = 5 * 60_000
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
const EXPIRABLE_REQUEST_STATUSES = new Set([
  'draft', 'validated', 'simulated', 'policy-decision', 'awaiting-human', 'approved'
])
const TERMINAL_REQUEST_STATUSES = new Set([
  'confirmed', 'rejected', 'expired', 'cancelled', 'failed'
])

/** A read or filter call Hronaut forwards to the EVM node; it never prompts, signs or sends. */
function isEvmNodeRead(input: unknown): boolean {
  const { family, method } = (input ?? {}) as { family?: unknown; method?: unknown }
  return family === 'evm' && typeof method === 'string'
    && ([...EVM_READ_RPC_METHODS, ...EVM_FILTER_RPC_METHODS] as readonly string[]).includes(method)
}

function sanitizedError(error: unknown): Error {
  const message = error instanceof Error ? error.message : 'Wallet request failed'
  const containsEndpoint = /(?:https?|wss?):\/\//i.test(message)
  const safe = !containsEndpoint
    && /^(?:Wallet|EVM|Solana|Tron|Requested|Unsupported|No wallet|Managed wallet|Watch-only|Invalid wallet|Cross-origin|Mainnet|Automatic wallet|Signed (?:EVM|Solana|Tron)|Transaction|Insufficient)[A-Za-z0-9_ .,:'"()/-]{0,480}$/.test(message)
    ? message
    : 'Wallet request failed validation or processing'
  return new Error(safe.slice(0, 512))
}

// Size in UTF-8 JSON bytes, as a page sends it; anything unserializable is unbounded.
function jsonBytes(value: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(value) ?? '', 'utf8')
  } catch {
    return Number.POSITIVE_INFINITY
  }
}

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

  listPending(): WalletRequestSummary[] {
    const wallets = new Map(this.service.list().map((wallet) => [wallet.id, wallet]))
    return this.service.approvals.list().map((record) => {
      const wallet = wallets.get(record.request.walletId)
      const result = summary(record, wallet)
      const pendingMessage = this.pendingMessages.get(record.id)
      if (result.details && pendingMessage && wallet) {
        result.details.raw = { ...result.details.raw, ...trustedMessageRaw(pendingMessage) }
        result.details.method = pendingMessage.kind === 'typed-data' ? 'typed-data-signing' : 'message-signing'
        const message = trustedMessageDisplay(pendingMessage, wallet, record.request.topLevelOrigin)
        if (message) {
          result.details.message = message
          // The whole text is on screen, so it is not an undecodable request.
          result.details.understood = !message.truncated && !message.warnings.includes('hidden-characters')
        }
        const typedData = pendingMessage.kind === 'typed-data' ? typedDataDisplay(pendingMessage.typedData, wallet) : undefined
        if (typedData) result.details.typedData = typedData
      }
      return result
    })
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

  prepareAgentTransaction(
    context: WalletBrokerContext,
    walletId: string,
    payload: unknown
  ): Promise<Record<string, unknown>> {
    return prepareAgentTransaction(this.agentWalletAccess(), context, walletId, payload)
  }

  requestAgentTransaction(
    context: WalletBrokerContext,
    walletId: string,
    payload: unknown,
    broadcast: boolean
  ): Promise<Record<string, unknown>> {
    return requestAgentTransaction(this.agentWalletAccess(), context, walletId, payload, broadcast)
  }

  requestAgentMessage(
    context: WalletBrokerContext,
    walletId: string,
    message: Uint8Array
  ): Promise<Record<string, unknown>> {
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

  updateWallet(walletId: string, changes: WalletUpdateInput): Promise<WalletDescriptor> {
    return this.queueLifecycle(async () => {
      const validated = WalletUpdateInputSchema.parse(changes)
      try {
        return await this.service.update(walletId, validated)
      } finally {
        this.reconcileProviderSessions()
        this.rejectCancelled()
      }
    })
  }

  setPolicy(input: WalletPolicy): Promise<WalletPolicy> {
    return this.queueLifecycle(() => this.service.setPolicy(input))
  }

  removePolicy(policyId: string): Promise<boolean> {
    return this.queueLifecycle(() => this.service.removePolicy(policyId))
  }

  removeWallet(walletId: string): Promise<boolean> {
    return this.queueLifecycle(async () => {
      try {
        return await this.service.remove(walletId)
      } finally {
        this.reconcileProviderSessions()
        this.rejectCancelled()
      }
    })
  }

  revokePermission(permissionId: string): Promise<boolean> {
    return this.queueLifecycle(async () => {
      const permission = this.service.permissions.get(permissionId)
      if (!permission) return false
      try {
        await this.service.approvals.cancelForPermission(permission)
        const revoked = await this.service.permissions.revoke(permissionId)
        if (revoked) {
          await this.service.audit.append('permission-revoked', {
            permissionId,
            walletId: permission.walletId,
            workspaceId: permission.workspaceId,
            origin: permission.origin,
            requester: permission.requester
          }, this.now().toISOString())
        }
        return revoked
      } finally {
        if (!this.service.permissions.get(permissionId)) this.reconcileProviderSessions()
        this.rejectCancelled()
      }
    })
  }

  refreshProviderSessions(): void {
    this.reconcileProviderSessions()
  }

  async providerRequest(context: WalletBrokerContext, input: WalletProviderRequest): Promise<unknown> {
    // Counted before any await, so the tab stays awake while the request is still being prepared.
    const holdsTab = context.requester.type === 'website' && !isEvmNodeRead(input)
    if (holdsTab) this.pageCallsInProgress.set(context.tabId, (this.pageCallsInProgress.get(context.tabId) ?? 0) + 1)
    try {
      if (this.shuttingDown) throw new Error('Wallet broker is shutting down')
      this.assertRequestContextActive(context)
      this.assertSupportedProviderMethod(input)
      const request = WalletProviderRequestSchema.parse(input)
      const wallets = this.accessibleWallets(context, request.family)
      if (request.family === 'evm') return await evmRequest(this.evmProviderAccess(), context, wallets, request.method, request.params)
      if (request.family === 'solana') return await solanaRequest(this.solanaTronProviderAccess(), context, wallets, request.method, request.params)
      return await tronRequest(this.solanaTronProviderAccess(), context, wallets, request.method, request.params)
    } catch (error) {
      const sanitized = sanitizedError(error)
      this.recordPageCallFailure(context, input, sanitized)
      throw sanitized
    } finally {
      if (holdsTab) {
        const inProgress = (this.pageCallsInProgress.get(context.tabId) ?? 1) - 1
        if (inProgress > 0) this.pageCallsInProgress.set(context.tabId, inProgress)
        else this.pageCallsInProgress.delete(context.tabId)
      }
    }
  }

  /**
   * Remembers a website's failed wallet call, such as an unsupported method or
   * a network it cannot switch to, so an agent testing the page can see why a
   * button did nothing. Reads forwarded to the node are left out: contracts
   * revert them routinely and the page gets the node's answer.
   */
  private recordPageCallFailure(context: WalletBrokerContext, input: WalletProviderRequest, error: Error): void {
    if (context.requester.type !== 'website' || !this.isRequestContextActive(context)) return
    const { family, method } = (input ?? {}) as { family?: unknown; method?: unknown }
    if (family !== 'evm' && family !== 'solana' && family !== 'tron') return
    const name = typeof method === 'string' && /^[A-Za-z0-9_]{1,128}$/.test(method) ? method : 'invalid'
    if (isEvmNodeRead(input)) return
    this.pageCallFailures.add(context, { family, method: name, error: error.message, failedAt: this.now().toISOString() })
  }

  private assertSupportedProviderMethod(input: unknown): void {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return
    const { family, method } = input as { family?: unknown; method?: unknown }
    if (typeof method !== 'string' || !/^[A-Za-z0-9_]{1,128}$/.test(method)) return
    if (family !== 'evm' && family !== 'solana' && family !== 'tron') return
    const supported: readonly string[] = WALLET_PROVIDER_METHODS[family]
    if (!supported.includes(method)) {
      const familyName = family === 'evm' ? 'EVM' : family === 'solana' ? 'Solana' : 'Tron'
      throw new Error(`Unsupported ${familyName} wallet method: ${method}`)
    }
  }

  approve(requestId: string): Promise<WalletRequestSummary> {
    const lockGeneration = this.lockGeneration
    return this.queueLifecycle(() => {
      if (lockGeneration !== this.lockGeneration) {
        throw new Error('Wallet request was cancelled because signing keys were locked')
      }
      return this.approveRequest(requestId)
    })
  }

  private async approveRequest(requestId: string): Promise<WalletRequestSummary> {
    const record = this.service.approvals.get(requestId)
    if (!record) throw new Error('Wallet request not found')
    if (record.status !== 'awaiting-human') throw new Error('Wallet request is not awaiting human approval')
    try {
      await this.service.approvals.approve(record.id, record.request, this.now())
    } catch (error) {
      const current = this.service.approvals.get(record.id)
      if (current?.status === 'expired') {
        const expired = new Error('Wallet request expired before approval')
        try {
          await this.service.audit.append('request-expired', {
            requestId: record.id,
            walletId: record.request.walletId,
            requester: record.request.requester,
            origin: record.request.topLevelOrigin
          }, this.now().toISOString())
        } finally {
          this.rejectPending(record.id, expired)
          this.publish()
        }
        throw expired
      }
      if (current?.status === 'approved') throw await this.fail(record.id, error)
      throw sanitizedError(error)
    }
    try {
      await this.service.audit.append('request-approved', {
        requestId: record.id, walletId: record.request.walletId, approvalHash: record.requestHash,
        requester: record.request.requester, origin: record.request.topLevelOrigin
      }, this.now().toISOString())
      const result = await this.execute(this.service.approvals.get(record.id)!)
      this.pending.get(record.id)?.resolve(result)
      this.pending.delete(record.id)
      this.clearRequestExpiry(record.id)
      this.publish()
      return summary(this.service.approvals.get(record.id)!, this.requireWallet(record.request.walletId))
    } catch (error) {
      throw await this.fail(record.id, error)
    }
  }

  async reject(requestId: string): Promise<WalletRequestSummary> {
    try {
      const record = await this.service.approvals.transition(requestId, 'rejected', this.now())
      await this.service.audit.append('request-rejected', {
        requestId, walletId: record.request.walletId, requester: record.request.requester, origin: record.request.topLevelOrigin
      }, this.now().toISOString())
      return summary(record, this.service.list().find((wallet) => wallet.id === record.request.walletId))
    } finally {
      if (this.service.approvals.get(requestId)?.status === 'rejected') {
        this.rejectPending(requestId, new Error('Wallet request was rejected by the user'))
        this.publish()
      }
    }
  }

  async cancelForNavigation(tabId: string, generation: number): Promise<void> {
    this.minimumNavigationGeneration.set(
      tabId,
      Math.max(generation, this.minimumNavigationGeneration.get(tabId) ?? 0)
    )
    this.clearEvmProviderSessions((session) => (
      session.tabId === tabId && session.navigationGeneration < generation
    ))
    this.clearAccountProviderSessions((session) => (
      session.tabId === tabId && session.navigationGeneration < generation
    ))
    await this.queueLifecycle(async () => {
      try {
        await this.service.approvals.cancelForNavigation(tabId, generation)
      } finally {
        this.rejectCancelled()
      }
    })
  }

  /**
   * Whether a page in this tab still waits on the wallet: a wallet call it
   * made that has not returned yet, from the moment it reaches the broker and
   * including a wallet_sendCalls batch still sending calls, or a request not
   * yet signed or sent, such as one an agent made for the tab. Putting the tab
   * to sleep would discard the page that gets the answer, while the request
   * could still be approved and sent.
   */
  keepsTabAwake(tabId: string): boolean {
    return (this.pageCallsInProgress.get(tabId) ?? 0) > 0 || this.service.approvals.hasUnsentForTab(tabId, this.now())
  }

  async cancelForTab(tabId: string): Promise<void> {
    this.closedTabs.add(tabId)
    this.clearEvmProviderSessions((session) => session.tabId === tabId)
    this.evmFilters.clear((owner) => owner.tabId === tabId)
    this.evmAssetSuggestions.clear((page) => page.tabId === tabId)
    this.pageCallFailures.clear((page) => page.tabId === tabId)
    this.clearAccountProviderSessions((session) => session.tabId === tabId)
    await this.queueLifecycle(async () => {
      try {
        await this.service.approvals.cancelForTab(tabId)
      } finally {
        this.rejectCancelled()
      }
    })
  }

  async resumeTab(tabId: string, navigationGeneration: number): Promise<void> {
    if (!Number.isSafeInteger(navigationGeneration) || navigationGeneration < 0) {
      throw new Error('Wallet tab navigation generation is invalid')
    }
    await this.queueLifecycle(async () => {
      this.minimumNavigationGeneration.set(
        tabId,
        Math.max(navigationGeneration, this.minimumNavigationGeneration.get(tabId) ?? 0)
      )
      this.closedTabs.delete(tabId)
    })
  }

  async cancelForWorkspace(workspaceId: string): Promise<void> {
    this.clearEvmProviderSessions((session) => session.workspaceId === workspaceId)
    this.evmFilters.clear((owner) => owner.workspaceId === workspaceId)
    this.evmCallBundles.clear((owner) => owner.workspaceId === workspaceId)
    this.evmAssetSuggestions.clear((page) => page.workspaceId === workspaceId)
    this.pageCallFailures.clear((page) => page.workspaceId === workspaceId)
    this.clearAccountProviderSessions((session) => session.workspaceId === workspaceId)
    await this.queueLifecycle(async () => {
      try {
        await Promise.all([
          this.service.approvals.cancelForWorkspace(workspaceId),
          this.service.permissions.revokeForWorkspace(workspaceId)
        ])
      } finally {
        this.rejectCancelled()
      }
    })
  }

  async cancelForRequester(requesterId: string): Promise<void> {
    const lifecycle = this.agentOperations.get(requesterId) ?? {
      activeOperations: 0,
      cancelled: false,
      drainWaiters: []
    }
    this.agentOperations.set(requesterId, lifecycle)
    lifecycle.cancelled = true
    this.clearEvmProviderSessions((session) => (
      session.requester.type === 'agent' && session.requester.id === requesterId
    ))
    this.clearAccountProviderSessions((session) => (
      session.requester.type === 'agent' && session.requester.id === requesterId
    ))
    const cancel = () => this.queueLifecycle(async () => {
      try {
        await this.service.approvals.cancelForRequester(requesterId)
      } finally {
        this.rejectCancelled()
      }
    })
    let cancellationError: unknown
    try {
      await cancel()
    } catch (error) {
      cancellationError = error
    }
    if (lifecycle.activeOperations > 0) {
      await new Promise<void>((resolve) => lifecycle.drainWaiters.push(resolve))
    }
    try {
      await cancel()
    } catch (error) {
      cancellationError ??= error
    }
    if (this.agentOperations.get(requesterId) === lifecycle) this.agentOperations.delete(requesterId)
    if (cancellationError) throw cancellationError
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

  private async connect(context: WalletBrokerContext, wallet: WalletDescriptor): Promise<unknown> {
    if (this.hasAddressPermission(context, wallet)) return [wallet.publicAddress]
    const key = JSON.stringify([
      wallet.id,
      context.workspaceId,
      context.tabId,
      context.navigationGeneration,
      context.topLevelOrigin,
      context.requester.type,
      context.requester.id
    ])
    const existing = this.pendingConnections.get(key)
    if (existing) return existing
    const connection = (async () => {
      const request = await this.createAddressPermissionRequest(context, wallet, true)
      return request.approved ? request.result : this.wait(request.record.id)
    })()
    this.pendingConnections.set(key, connection)
    try {
      return await connection
    } finally {
      if (this.pendingConnections.get(key) === connection) this.pendingConnections.delete(key)
    }
  }

  private async transactionRequest(
    context: WalletBrokerContext,
    wallet: WalletDescriptor,
    payload: unknown,
    broadcast: boolean,
    returnSummary = false,
    prepared?: WalletNormalizedTransaction
  ): Promise<unknown> {
    const adapter = this.adapters[wallet.chainFamily]
    const normalized = prepared ?? await adapter.normalizeTransaction(wallet, payload)
    this.assertRequestContextActive(context)
    const operation: WalletOperation = broadcast ? 'sign-and-send-transaction' : 'sign-transaction'
    const currentWallet = this.requireAccessibleWallet(context, wallet.id)
    this.assertAddressPermission(context, currentWallet, broadcast ? 'send' : 'sign')
    const record = await this.createRequest(context, currentWallet, operation, broadcast ? 'send' : 'sign', {
      normalized: walletJsonSafe(normalized)
    })
    try {
      await this.service.approvals.transition(record.id, 'validated', this.now())
      const simulation = sanitizedSimulation(await adapter.simulate(wallet, normalized))
      this.assertRequestContextActive(context)
      await this.service.approvals.recordSimulation(record.id, simulation, this.now())
      await this.service.approvals.transition(record.id, 'simulated', this.now())
      await this.service.approvals.transition(record.id, 'policy-decision', this.now())
      const policies = this.service.policies.list(wallet.id)
        .filter((policy) => wallet.policyIds.includes(policy.id))
      const policyUsage = new Map(policies.map((policy) => [
        policy.id,
        this.service.policyUsage.snapshot(policy.id, this.now())
      ]))
      const usageByPolicy = Object.fromEntries([...policyUsage].map(([policyId, usage]) => [policyId, {
        sessionSpend: usage.sessionSpend,
        dailySpend: usage.dailySpend,
        operationCount: usage.operationCount
      }]))
      const decision = this.policy.evaluate({
        request: this.service.approvals.get(record.id)!.request,
        wallet,
        policies,
        decoded: normalized.decoded,
        simulation,
        now: this.now(),
        sessionSpend: '0', dailySpend: '0', operationCount: 0, usageByPolicy
      })
      await this.service.audit.append('request-simulated', {
        requestId: record.id, walletId: wallet.id, success: simulation.success, attempted: simulation.attempted,
        policyDecision: decision.outcome, reason: decision.reason
      }, this.now().toISOString())
      if (decision.outcome === 'rejected') {
        await this.service.approvals.transition(record.id, 'rejected', this.now())
        this.clearRequestExpiry(record.id)
        throw new Error(`Wallet policy rejected the request: ${decision.reason}`)
      }
      if (decision.outcome === 'approved') {
        this.assertRequestContextActive(context)
        const policy = policies.find((entry) => entry.id === decision.policyId)
        if (!policy) throw new Error('Wallet automatic policy is unavailable')
        const reservation = await this.service.policyUsage.reserve(policy, normalized.decoded.nativeAmount, this.now())
        if (!reservation.reserved) {
          await this.service.audit.append('policy-reservation-denied', {
            requestId: record.id, walletId: wallet.id, policyId: policy.id, reason: reservation.reason
          }, this.now().toISOString())
          await this.service.approvals.transition(record.id, 'awaiting-human', this.now())
          if (returnSummary) this.publish()
          return returnSummary
            ? agentSummary(this.service.approvals.get(record.id)!, wallet)
            : this.wait(record.id)
        }
        await this.service.audit.append('policy-reservation-created', {
          requestId: record.id, walletId: wallet.id, policyId: policy.id,
          operationCount: reservation.snapshot.operationCount,
          sessionSpend: reservation.snapshot.sessionSpend,
          dailySpend: reservation.snapshot.dailySpend
        }, this.now().toISOString())
        let policyInvalidated = false
        const result = await this.queueLifecycle(async () => {
          this.assertRequestContextActive(context)
          const currentWallet = this.requireAccessibleWallet(context, wallet.id)
          const currentPolicy = this.service.policies.list(wallet.id)
            .find((entry) => entry.id === policy.id)
          const authorizationNow = this.now()
          if (
            !currentPolicy
            || !currentWallet.policyIds.includes(policy.id)
            || !isDeepStrictEqual(currentPolicy, policy)
            || Date.parse(currentPolicy.expiresAt) <= authorizationNow.getTime()
            || (
              currentWallet.network.environment === 'mainnet'
              && !isMainnetAgentAutomationPolicy(currentPolicy, authorizationNow)
            )
          ) {
            policyInvalidated = true
            await this.service.audit.append('policy-authorization-invalidated', {
              requestId: record.id, walletId: wallet.id, policyId: policy.id
            }, this.now().toISOString())
            await this.service.approvals.transition(record.id, 'awaiting-human', this.now())
            return undefined
          }
          const current = this.service.approvals.get(record.id)!
          await this.service.approvals.approve(record.id, current.request, this.now())
          this.assertRequestContextActive(context)
          return this.execute(this.service.approvals.get(record.id)!, context)
        })
        if (policyInvalidated) {
          const current = this.service.approvals.get(record.id)!
          if (returnSummary) this.publish()
          return returnSummary ? agentSummary(current, this.requireWallet(wallet.id)) : this.wait(record.id)
        }
        this.clearRequestExpiry(record.id)
        return returnSummary ? agentSummary(this.service.approvals.get(record.id)!, wallet) : result
      }
      await this.service.approvals.transition(record.id, 'awaiting-human', this.now())
      if (returnSummary) this.publish()
      return returnSummary
        ? agentSummary(this.service.approvals.get(record.id)!, wallet)
        : this.wait(record.id)
    } catch (error) {
      throw await this.fail(record.id, error)
    }
  }

  private async messageRequest(
    context: WalletBrokerContext,
    wallet: WalletDescriptor,
    input: WalletMessageSigningInput,
    rawSigning = false,
    returnSummary = false
  ): Promise<unknown> {
    const currentWallet = this.requireAccessibleWallet(context, wallet.id)
    this.assertAddressPermission(context, currentWallet, 'sign')
    const retainedInput: WalletMessageSigningInput = input.kind === 'message'
      ? { kind: 'message', message: Uint8Array.from(input.message) }
      : structuredClone(input)
    const serialized = JSON.stringify(walletJsonSafe(retainedInput))
    const messageHash = createHash('sha256')
      .update('hronaut-wallet-message-v1\u0000')
      .update(serialized)
      .digest('hex')
    const record = await this.createRequest(context, currentWallet, 'sign-message', 'sign', {
      messageHash,
      messageKind: retainedInput.kind,
      messageLength: Buffer.byteLength(serialized, 'utf8'),
      rawSigning
    })
    this.pendingMessages.set(record.id, retainedInput)
    try {
      await this.service.approvals.transition(record.id, 'validated', this.now())
      await this.service.approvals.recordSimulation(record.id, { attempted: false, success: false }, this.now())
      await this.service.approvals.transition(record.id, 'simulated', this.now())
      await this.service.approvals.transition(record.id, 'policy-decision', this.now())
      const signIn = this.websiteSignInDecision(context, currentWallet, record.id, retainedInput.kind === 'message'
        ? { kind: 'message', bytes: retainedInput.message, raw: rawSigning }
        : { kind: 'typed-data', typedData: retainedInput.typedData, serializedBytes: jsonBytes(retainedInput.typedData) })
      await this.service.audit.append('request-simulated', {
        requestId: record.id, walletId: wallet.id, success: false, attempted: false,
        policyDecision: signIn?.decision.outcome ?? 'awaiting-human',
        reason: signIn?.decision.reason ?? (rawSigning ? 'raw-signing-requires-human' : 'message-signing-requires-human')
      }, this.now().toISOString())
      if (signIn?.decision.outcome === 'approved') {
        const automatic = await this.approveWebsiteSignIn(
          context, currentWallet, record.id, signIn.policies, signIn.decision.policyId, retainedInput.kind === 'typed-data'
        )
        if (automatic.approved) {
          this.clearRequestExpiry(record.id)
          this.publish()
          return automatic.result
        }
      }
      await this.service.approvals.transition(record.id, 'awaiting-human', this.now())
      if (returnSummary) this.publish()
      return returnSummary
        ? agentSummary(this.service.approvals.get(record.id)!, wallet)
        : this.wait(record.id)
    } catch (error) {
      throw await this.fail(record.id, error)
    }
  }

  private async execute(
    record: WalletApprovalRecord,
    activeAgentContext?: WalletBrokerContext,
    options: { permissionNotAfter?: string } = {}
  ): Promise<unknown> {
    this.assertRecordPageActive(record)
    if (activeAgentContext) this.assertRequestContextActive(activeAgentContext)
    if (record.request.operation === 'connect-account') {
      const wallet = this.requireWallet(record.request.walletId)
      if (!walletAllowsWorkspace(wallet, record.request.workspaceId)) {
        throw new Error('Wallet is no longer attached to the requesting workspace')
      }
      if (activeAgentContext) this.assertRequestContextActive(activeAgentContext)
      const permissionScope = {
        walletId: wallet.id, workspaceId: record.request.workspaceId, origin: record.request.topLevelOrigin,
        account: wallet.publicAddress, chainFamily: wallet.chainFamily, networkId: wallet.network.id,
        requester: record.request.requester
      }
      let grantedPermissionId: string | undefined
      let permissionCommitted = false
      try {
        if (!this.service.permissions.allows({ ...permissionScope, capability: 'read' }, this.now())) {
          const permission = await this.service.permissions.grant({
            ...permissionScope,
            capabilities: ['read'],
            // Access granted by a sign-in policy never outlives that policy.
            expiresAt: new Date(Math.min(
              this.now().getTime() + 30 * 24 * 60 * 60_000,
              options.permissionNotAfter ? Date.parse(options.permissionNotAfter) : Number.POSITIVE_INFINITY
            )).toISOString()
          })
          grantedPermissionId = permission.id
        }
        this.assertRecordPageActive(record)
        if (activeAgentContext) this.assertRequestContextActive(activeAgentContext)
        await this.service.approvals.transition(record.id, 'signing', this.now())
        this.assertRecordPageActive(record)
        if (activeAgentContext) this.assertRequestContextActive(activeAgentContext)
        await this.service.approvals.transition(record.id, 'confirmed', this.now())
        permissionCommitted = true
      } catch (error) {
        if (grantedPermissionId && !permissionCommitted) {
          await this.service.permissions.revoke(grantedPermissionId)
        }
        throw error
      }
      if (wallet.chainFamily === 'evm') {
        reconcileEvmProviderSessions(this.evmProviderAccess())
        this.scheduleProviderPermissionExpiry()
      }
      return [wallet.publicAddress]
    }
    const wallet = this.requireWallet(record.request.walletId)
    if (!walletAllowsWorkspace(wallet, record.request.workspaceId)) {
      throw new Error('Wallet is no longer attached to the requesting workspace')
    }
    if (!this.service.permissions.allows({
      walletId: wallet.id,
      workspaceId: record.request.workspaceId,
      origin: record.request.topLevelOrigin,
      account: wallet.publicAddress,
      chainFamily: wallet.chainFamily,
      networkId: wallet.network.id,
      requester: record.request.requester,
      capability: 'read'
    }, this.now())) {
      throw new Error('Wallet account access was revoked before signing')
    }
    if (record.request.operation === 'sign-message') {
      const input = this.pendingMessages.get(record.id)
      if (!input) throw new Error('Wallet message payload is unavailable after restart or cancellation')
      const serialized = JSON.stringify(walletJsonSafe(input))
      const messageHash = createHash('sha256')
        .update('hronaut-wallet-message-v1\u0000')
        .update(serialized)
        .digest('hex')
      if (messageHash !== record.request.payload.messageHash) throw new Error('Approved wallet message has changed')
      const authorization = this.service.authorizeSigning(record.id)
      await this.service.approvals.markSigning(record.id, record.request, this.now())
      this.assertRecordPageActive(record)
      if (activeAgentContext) this.assertRequestContextActive(activeAgentContext)
      try {
        const signature = await this.service.withSecret(wallet.id, authorization, (_descriptor, secret) => (
          signWalletPayload(wallet.chainFamily, secret, input, wallet.publicAddress)
        ))
        this.assertRecordPageActive(record)
        if (activeAgentContext) this.assertRequestContextActive(activeAgentContext)
        await this.service.approvals.transition(record.id, 'confirmed', this.now())
        return signature
      } finally {
        this.clearPendingMessage(record.id)
      }
    }
    const restored = restoreWalletJson(record.request.payload.normalized) as WalletNormalizedTransaction
    const adapter = this.adapters[wallet.chainFamily]
    const authorization = this.service.authorizeSigning(record.id)
    await this.service.approvals.markSigning(record.id, record.request, this.now())
    this.assertRecordPageActive(record)
    if (activeAgentContext) this.assertRequestContextActive(activeAgentContext)
    const signed = await this.service.withSecret(wallet.id, authorization, (descriptor, secret) => adapter.sign(descriptor, secret, restored))
    this.assertRecordPageActive(record)
    if (activeAgentContext) this.assertRequestContextActive(activeAgentContext)
    if (record.request.operation === 'sign-transaction') {
      await this.service.approvals.transition(record.id, 'confirmed', this.now())
      return signed
    }
    const transactionHash = await adapter.broadcast(wallet, signed)
    await this.service.approvals.markSubmitted(record.id, transactionHash, this.now())
    await appendTransactionAudit(this.transactionConfirmationAccess(), 'transaction-submitted', record, transactionHash)
    scheduleConfirmation(this.transactionConfirmationAccess(), record.id)
    return transactionHash
  }

  private async createRequest(
    context: WalletBrokerContext,
    wallet: WalletDescriptor,
    operation: WalletOperation,
    capability: 'read' | 'sign' | 'send',
    payload: Record<string, unknown>
  ): Promise<WalletApprovalRecord> {
    this.assertRequestContextActive(context)
    const now = this.now()
    const request: WalletOperationRequest = {
      requestId: randomUUID(), walletId: wallet.id, workspaceId: context.workspaceId, tabId: context.tabId,
      navigationGeneration: context.navigationGeneration, topLevelOrigin: context.topLevelOrigin,
      requester: structuredClone(context.requester), capability, chainFamily: wallet.chainFamily,
      networkId: wallet.network.id, operation, payload,
      expiresAt: new Date(now.getTime() + this.requestTtlMs()).toISOString()
    }
    const record = await this.service.approvals.create(request, `${context.requester.type}:${context.requester.id}:${request.requestId}`, now)
    if (!this.isRequestContextActive(context)) {
      const current = this.service.approvals.get(record.id)
      try {
        if (current && EXPIRABLE_REQUEST_STATUSES.has(current.status)) {
          await this.service.approvals.cancel(record.id, this.now())
        }
      } finally {
        this.rejectCancelled()
      }
      this.assertAgentOperationActive(context)
      throw new Error('Wallet request page is no longer active')
    }
    try {
      await this.service.audit.append('request-created', {
        requestId: record.id, walletId: wallet.id, workspaceId: context.workspaceId, origin: context.topLevelOrigin,
        requester: context.requester, operation
      }, now.toISOString())
      this.scheduleRequestExpiry(record)
      this.publish()
      return record
    } catch (error) {
      throw await this.fail(record.id, error)
    }
  }

  private wait(requestId: string): Promise<unknown> {
    const record = this.service.approvals.get(requestId)
    if (!record || !EXPIRABLE_REQUEST_STATUSES.has(record.status)) {
      this.clearRequestExpiry(requestId)
      return Promise.reject(new Error(`Wallet request was ${record?.status ?? 'not found'}`))
    }
    return new Promise((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject })
      this.publish()
    })
  }

  private async withAgentOperation<T>(context: WalletBrokerContext, operation: () => Promise<T>): Promise<T> {
    if (this.shuttingDown) throw new Error('Wallet broker is shutting down')
    if (context.requester.type !== 'agent') return operation()
    const requesterId = context.requester.id
    const lifecycle = this.agentOperations.get(requesterId) ?? {
      activeOperations: 0,
      cancelled: false,
      drainWaiters: []
    }
    this.agentOperations.set(requesterId, lifecycle)
    if (lifecycle.cancelled || !this.isRequestContextActive(context)) {
      if (lifecycle.activeOperations === 0 && this.agentOperations.get(requesterId) === lifecycle) {
        this.agentOperations.delete(requesterId)
      }
      throw new Error('Wallet requester session is no longer active')
    }
    lifecycle.activeOperations += 1
    try {
      try {
        return await operation()
      } catch (error) {
        throw sanitizedError(error)
      }
    } finally {
      lifecycle.activeOperations = Math.max(0, lifecycle.activeOperations - 1)
      if (lifecycle.activeOperations === 0) {
        for (const resolve of lifecycle.drainWaiters.splice(0)) resolve()
        if (!lifecycle.cancelled && this.agentOperations.get(requesterId) === lifecycle) {
          this.agentOperations.delete(requesterId)
        }
      }
    }
  }

  private isAgentOperationActive(context: WalletBrokerContext): boolean {
    if (context.requester.type !== 'agent') return true
    return context.signal?.aborted !== true
      && this.agentOperations.get(context.requester.id)?.cancelled !== true
  }

  private assertAgentOperationActive(context: WalletBrokerContext): void {
    if (context.requester.type === 'agent') this.options.assertAgentAccess?.()
    if (!this.isAgentOperationActive(context)) throw new Error('Wallet requester session is no longer active')
  }

  private isRequestContextActive(context: WalletBrokerContext): boolean {
    const minimumGeneration = this.minimumNavigationGeneration.get(context.tabId)
    return !this.shuttingDown && !this.closedTabs.has(context.tabId)
      && (minimumGeneration === undefined || context.navigationGeneration >= minimumGeneration)
      && this.isAgentOperationActive(context)
  }

  private assertRequestContextActive(context: WalletBrokerContext): void {
    if (this.shuttingDown) throw new Error('Wallet broker is shutting down')
    this.assertAgentOperationActive(context)
    const minimumGeneration = this.minimumNavigationGeneration.get(context.tabId)
    if (
      this.closedTabs.has(context.tabId)
      || (minimumGeneration !== undefined && context.navigationGeneration < minimumGeneration)
    ) throw new Error('Wallet request page is no longer active')
  }

  private assertRecordPageActive(record: WalletApprovalRecord): void {
    if (record.request.requester.type === 'agent') this.options.assertAgentAccess?.()
    const minimumGeneration = this.minimumNavigationGeneration.get(record.request.tabId)
    if (
      this.closedTabs.has(record.request.tabId)
      || (minimumGeneration !== undefined && record.request.navigationGeneration < minimumGeneration)
    ) throw new Error('Wallet request page is no longer active')
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

  private hasAddressPermission(context: WalletBrokerContext, wallet: WalletDescriptor): boolean {
    return this.service.permissions.allows({
      walletId: wallet.id, workspaceId: context.workspaceId, origin: context.topLevelOrigin,
      account: wallet.publicAddress, chainFamily: wallet.chainFamily, networkId: wallet.network.id,
      requester: context.requester, capability: 'read'
    }, this.now())
  }

  private disconnectWallet(context: WalletBrokerContext, wallet: WalletDescriptor): Promise<void> {
    return this.queueLifecycle(async () => {
      const permission = this.service.permissions.list().find((entry) => (
        entry.walletId === wallet.id
        && entry.workspaceId === context.workspaceId
        && entry.origin === context.topLevelOrigin
        && entry.account === wallet.publicAddress
        && entry.chainFamily === wallet.chainFamily
        && entry.networkId === wallet.network.id
        && (entry.requester?.type ?? 'website') === context.requester.type
        && (entry.requester?.id ?? entry.origin) === context.requester.id
      ))
      try {
        await this.service.approvals.cancelForPermission({
          walletId: wallet.id,
          workspaceId: context.workspaceId,
          origin: context.topLevelOrigin,
          networkId: wallet.network.id,
          requester: context.requester
        })
        if (permission && await this.service.permissions.revoke(permission.id)) {
          await this.service.audit.append('permission-revoked', {
            permissionId: permission.id,
            walletId: permission.walletId,
            workspaceId: permission.workspaceId,
            origin: permission.origin,
            requester: permission.requester
          }, this.now().toISOString())
        }
        this.clearAccountProviderSessions((session) => (
          session.family === wallet.chainFamily
          && session.walletId === wallet.id
          && session.workspaceId === context.workspaceId
          && session.tabId === context.tabId
          && session.navigationGeneration === context.navigationGeneration
          && session.topLevelOrigin === context.topLevelOrigin
          && session.requester.type === context.requester.type
          && session.requester.id === context.requester.id
        ))
        this.options.onProviderEvent?.(context.tabId, { family: wallet.chainFamily, event: 'disconnect' })
      } finally {
        this.rejectCancelled()
      }
    })
  }

  private async createAddressPermissionRequest(
    context: WalletBrokerContext,
    wallet: WalletDescriptor,
    allowWebsiteSignIn = false
  ): Promise<{ record: WalletApprovalRecord; approved: false } | { record: WalletApprovalRecord; approved: true; result: unknown }> {
    const currentWallet = this.requireAccessibleWallet(context, wallet.id)
    const record = await this.createRequest(context, currentWallet, 'connect-account', 'read', { account: currentWallet.publicAddress })
    try {
      await this.service.approvals.transition(record.id, 'validated', this.now())
      await this.service.approvals.recordSimulation(record.id, { attempted: false, success: false }, this.now())
      await this.service.approvals.transition(record.id, 'simulated', this.now())
      await this.service.approvals.transition(record.id, 'policy-decision', this.now())
      const signIn = allowWebsiteSignIn ? this.websiteSignInDecision(context, currentWallet, record.id) : undefined
      if (signIn) {
        await this.service.audit.append('request-simulated', {
          requestId: record.id, walletId: currentWallet.id, success: false, attempted: false,
          policyDecision: signIn.decision.outcome, reason: signIn.decision.reason
        }, this.now().toISOString())
        if (signIn.decision.outcome === 'approved') {
          const automatic = await this.approveWebsiteSignIn(context, currentWallet, record.id, signIn.policies, signIn.decision.policyId)
          if (automatic.approved) {
            this.clearRequestExpiry(record.id)
            this.publish()
            return { record: this.service.approvals.get(record.id)!, approved: true, result: automatic.result }
          }
        }
      }
      await this.service.approvals.transition(record.id, 'awaiting-human', this.now())
      this.publish()
      return { record: this.service.approvals.get(record.id)!, approved: false }
    } catch (error) {
      throw await this.fail(record.id, error)
    }
  }

  /**
   * Evaluates a website's connection or message request against the wallet's
   * opted-in sign-in policies. Returns undefined when no attached policy allows
   * website sign-in, so requests on other wallets keep their existing path.
   */
  private websiteSignInDecision(
    context: WalletBrokerContext,
    wallet: WalletDescriptor,
    recordId: string,
    message?: WalletWebsiteSignInEvaluation['message']
  ): { decision: WalletPolicyDecision; policies: WalletPolicy[] } | undefined {
    if (context.requester.type !== 'website') return undefined
    const policies = this.service.policies.list(wallet.id)
      .filter((policy) => wallet.policyIds.includes(policy.id) && policy.allowWebsiteSignIn === true)
    if (!policies.length) return undefined
    const now = this.now()
    const usageByPolicy = Object.fromEntries(policies.map((policy) => [
      policy.id,
      { operationCount: this.service.policyUsage.snapshot(policy.id, now).operationCount }
    ]))
    const decision = this.policy.evaluateWebsiteSignIn({
      request: this.service.approvals.get(recordId)!.request,
      wallet,
      policies,
      now,
      usageByPolicy,
      ...(message ? { message } : {})
    })
    return { decision, policies }
  }

  /**
   * Reserves one operation on the matching sign-in policy, re-checks the
   * policy and wallet inside the lifecycle queue, including the typed-data
   * switch for typed data, then approves and executes the request as the
   * policy. Anything that changed returns it to a person.
   */
  private async approveWebsiteSignIn(
    context: WalletBrokerContext,
    wallet: WalletDescriptor,
    recordId: string,
    policies: readonly WalletPolicy[],
    policyId: string,
    typedData = false
  ): Promise<{ approved: false } | { approved: true; result: unknown }> {
    this.assertRequestContextActive(context)
    const policy = policies.find((entry) => entry.id === policyId)
    if (!policy) throw new Error('Wallet automatic policy is unavailable')
    const reservation = await this.service.policyUsage.reserve(policy, '0', this.now())
    if (!reservation.reserved) {
      await this.service.audit.append('policy-reservation-denied', {
        requestId: recordId, walletId: wallet.id, policyId: policy.id, reason: reservation.reason
      }, this.now().toISOString())
      return { approved: false }
    }
    await this.service.audit.append('policy-reservation-created', {
      requestId: recordId, walletId: wallet.id, policyId: policy.id,
      operationCount: reservation.snapshot.operationCount
    }, this.now().toISOString())
    return this.queueLifecycle(async () => {
      this.assertRequestContextActive(context)
      const currentWallet = this.requireAccessibleWallet(context, wallet.id)
      const currentPolicy = this.service.policies.list(wallet.id).find((entry) => entry.id === policy.id)
      const current = this.service.approvals.get(recordId)!
      const authorizationNow = this.now()
      if (
        !currentPolicy
        || !currentWallet.policyIds.includes(policy.id)
        || !isDeepStrictEqual(currentPolicy, policy)
        || currentWallet.network.id !== current.request.networkId
        || !websiteSignInPolicyApplies(currentWallet, currentPolicy, authorizationNow)
        || (typedData && !websiteTypedDataPolicyApplies(currentWallet, currentPolicy, authorizationNow))
      ) {
        await this.service.audit.append('policy-authorization-invalidated', {
          requestId: recordId, walletId: wallet.id, policyId: policy.id
        }, this.now().toISOString())
        return { approved: false }
      }
      await this.service.approvals.approve(recordId, current.request, authorizationNow)
      await this.service.audit.append('request-approved-by-policy', {
        requestId: recordId, walletId: wallet.id, policyId: policy.id,
        operation: current.request.operation, requester: current.request.requester, origin: current.request.topLevelOrigin
      }, this.now().toISOString())
      this.assertRequestContextActive(context)
      const result = await this.execute(this.service.approvals.get(recordId)!, context, { permissionNotAfter: currentPolicy.expiresAt })
      return { approved: true, result }
    })
  }

  private selectWallet(wallets: WalletDescriptor[]): WalletDescriptor {
    const wallet = wallets.find((entry) => entry.kind !== 'watch-only') ?? wallets[0]
    if (!wallet) throw new Error('No wallet is attached to this workspace for the requested chain')
    return wallet
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

  private assertAddressPermission(context: WalletBrokerContext, wallet: WalletDescriptor, capability: 'sign' | 'send'): void {
    if (!this.service.permissions.allows({
      walletId: wallet.id, workspaceId: context.workspaceId, origin: context.topLevelOrigin,
      account: wallet.publicAddress, chainFamily: wallet.chainFamily, networkId: wallet.network.id,
      requester: context.requester, capability: 'read'
    }, this.now())) throw new Error(`Wallet account access must be approved before ${capability}`)
  }

  private requireWallet(walletId: string): WalletDescriptor {
    const wallet = this.service.list().find((entry) => entry.id === walletId)
    if (!wallet) throw new Error('Wallet not found')
    return wallet
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

  private async fail(requestId: string, error: unknown): Promise<Error> {
    const record = this.service.approvals.get(requestId)
    let failure = this.terminalRequestFailure(record) ?? sanitizedError(error)
    try {
      if (record && !TERMINAL_REQUEST_STATUSES.has(record.status)) {
        try {
          await this.service.approvals.transition(requestId, 'failed', this.now())
          await this.service.audit.append('request-failed', { requestId, error: failure.message }, this.now().toISOString())
        } catch (transitionError) {
          const concurrentTerminalFailure = this.terminalRequestFailure(this.service.approvals.get(requestId))
          if (!concurrentTerminalFailure) throw transitionError
          failure = concurrentTerminalFailure
        }
      }
    } finally {
      failure = this.terminalRequestFailure(this.service.approvals.get(requestId)) ?? failure
      this.rejectPending(requestId, failure)
      this.publish()
    }
    return failure
  }

  private terminalRequestFailure(record: WalletApprovalRecord | undefined): Error | undefined {
    if (record?.status === 'cancelled') return new Error('Wallet request was cancelled')
    if (record?.status === 'expired') return new Error('Wallet request was expired')
    if (record?.status === 'rejected') return new Error('Wallet request was rejected by the user')
    return undefined
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

  private publish(): void {
    this.options.onPendingChanged?.(this.listPending())
  }

  private clearPendingMessage(requestId: string): void {
    const input = this.pendingMessages.get(requestId)
    if (input?.kind === 'message') input.message.fill(0)
    this.pendingMessages.delete(requestId)
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

  private scheduleRequestExpiry(record: WalletApprovalRecord): void {
    this.clearRequestExpiry(record.id)
    const delay = Math.max(0, Date.parse(record.request.expiresAt) - this.now().getTime())
    const expire = () => {
      this.requestExpiryCancellations.delete(record.id)
      void this.queueLifecycle(() => this.expireRequest(record.id)).catch(() => undefined)
    }
    const cancel = this.options.requestExpiryScheduler?.(expire, delay) ?? (() => {
      const timer = setTimeout(expire, delay)
      timer.unref()
      return () => clearTimeout(timer)
    })()
    this.requestExpiryCancellations.set(record.id, cancel)
  }

  private async expireRequest(requestId: string): Promise<void> {
    const record = this.service.approvals.get(requestId)
    if (!record || !EXPIRABLE_REQUEST_STATUSES.has(record.status)) return
    const now = this.now()
    if (Date.parse(record.request.expiresAt) > now.getTime()) {
      this.scheduleRequestExpiry(record)
      return
    }
    try {
      await this.service.approvals.transition(requestId, 'expired', now)
      await this.service.audit.append('request-expired', {
        requestId,
        walletId: record.request.walletId,
        requester: record.request.requester,
        origin: record.request.topLevelOrigin
      }, now.toISOString())
    } finally {
      this.rejectPending(requestId, new Error('Wallet request expired'))
      this.publish()
    }
  }

  private clearRequestExpiry(requestId: string): void {
    this.requestExpiryCancellations.get(requestId)?.()
    this.requestExpiryCancellations.delete(requestId)
  }

  private requestTtlMs(): number {
    const value = this.options.requestTtlMs ?? DEFAULT_REQUEST_TTL_MS
    if (!Number.isSafeInteger(value) || value < 1 || value > DEFAULT_REQUEST_TTL_MS) {
      throw new Error('Wallet request expiry must be between 1 ms and 5 minutes')
    }
    return value
  }

  private confirmationPollIntervalMs(): number {
    const value = this.options.confirmationPollIntervalMs ?? DEFAULT_CONFIRMATION_POLL_INTERVAL_MS
    return Number.isSafeInteger(value) && value > 0 ? value : DEFAULT_CONFIRMATION_POLL_INTERVAL_MS
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
