import { createHash, randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { address, getAddressEncoder, getBase58Encoder } from '@solana/kit'
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
  WalletUpdateInput
} from '../../shared/wallet.js'
import { WalletProviderRequestSchema, WalletUpdateInputSchema, walletAllowsWorkspace } from '../../shared/wallet.js'
import { signWalletPayload, type WalletMessageSigningInput } from './accounts.js'
import type { WalletApprovalRecord } from './approvals.js'
import { EvmWalletAdapter } from './adapters/evm.js'
import { SolanaWalletAdapter } from './adapters/solana.js'
import { TronWalletAdapter } from './adapters/tron.js'
import type {
  WalletChainAdapter,
  WalletNormalizedTransaction,
  WalletTransactionSimulation
} from './adapters/types.js'
import { restoreWalletJson, walletJsonInspectable, walletJsonSafe } from './json-safe.js'
import { isMainnetAgentAutomationPolicy, WalletPolicyEngine } from './policy.js'
import type { WalletService } from './service.js'

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

interface EvmProviderSession {
  workspaceId: string
  tabId: string
  navigationGeneration: number
  topLevelOrigin: string
  requester: WalletRequester
  networkId: string
  accounts: string[]
}

export interface WalletBrokerOptions {
  adapters?: Partial<Record<WalletChainFamily, WalletChainAdapter>>
  now?: () => Date
  requestTtlMs?: number
  confirmationPollIntervalMs?: number
  shutdownDrainTimeoutMs?: number
  onPendingChanged?: (requests: WalletRequestSummary[]) => void
  onProviderEvent?: (tabId: string, event: WalletProviderEvent) => void
}

const DEFAULT_REQUEST_TTL_MS = 5 * 60_000
const DEFAULT_CONFIRMATION_POLL_INTERVAL_MS = 5_000
const DEFAULT_SHUTDOWN_DRAIN_TIMEOUT_MS = 2_000
const EXPIRABLE_REQUEST_STATUSES = new Set([
  'draft', 'validated', 'simulated', 'policy-decision', 'awaiting-human', 'approved'
])
const TERMINAL_REQUEST_STATUSES = new Set([
  'confirmed', 'rejected', 'expired', 'cancelled', 'failed'
])

function sanitizedError(error: unknown): Error {
  const message = error instanceof Error ? error.message : 'Wallet request failed'
  const containsEndpoint = /(?:https?|wss?):\/\//i.test(message)
  const safe = !containsEndpoint
    && /^(?:Wallet|EVM|Solana|Tron|Requested|Unsupported|No wallet|Managed wallet|Watch-only|Invalid wallet|Cross-origin|Mainnet|Automatic wallet|Signed (?:EVM|Solana|Tron)|Transaction|Insufficient)[A-Za-z0-9 .,:'"()/-]{0,480}$/.test(message)
    ? message
    : 'Wallet request failed validation or processing'
  return new Error(safe.slice(0, 512))
}

function walletChainName(family: WalletChainFamily): string {
  if (family === 'evm') return 'EVM'
  return family === 'solana' ? 'Solana' : 'Tron'
}

function sanitizedSimulation(simulation: WalletTransactionSimulation): WalletTransactionSimulation {
  return {
    attempted: simulation.attempted,
    success: simulation.success,
    ...(simulation.estimatedFee && /^\d+(?:\.\d+)?$/.test(simulation.estimatedFee)
      ? { estimatedFee: simulation.estimatedFee }
      : {}),
    ...(simulation.error ? { error: 'Wallet transaction simulation failed' } : {})
  }
}

function paramsArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : value === undefined ? [] : [value]
}

function summary(record: WalletApprovalRecord, wallet?: WalletDescriptor): WalletRequestSummary {
  const normalized = record.request.payload.normalized
    ? restoreWalletJson(record.request.payload.normalized) as WalletNormalizedTransaction
    : undefined
  return {
    id: record.id,
    walletId: record.request.walletId,
    workspaceId: record.request.workspaceId,
    status: record.status,
    approvalHash: record.approvalHash ?? record.requestHash,
    operation: record.request.operation,
    requester: structuredClone(record.request.requester),
    origin: record.request.topLevelOrigin,
    networkId: record.request.networkId,
    createdAt: record.createdAt,
    expiresAt: record.request.expiresAt,
    ...(record.transactionHash ? { transactionHash: record.transactionHash } : {}),
    ...(wallet ? {
      details: {
        walletName: wallet.name,
        publicAddress: wallet.publicAddress,
        chainFamily: wallet.chainFamily,
        networkName: wallet.network.name,
        capability: record.request.capability,
        understood: normalized?.decoded.understood ?? record.request.operation === 'connect-account',
        simulationAttempted: record.simulation?.attempted ?? false,
        simulationSuccess: record.simulation?.success ?? false,
        ...(normalized?.decoded.destination ? { destination: normalized.decoded.destination } : {}),
        ...(normalized?.decoded.method ? { method: normalized.decoded.method } : {}),
        ...(normalized?.decoded.nativeAmount ? { nativeAmount: normalized.decoded.nativeAmount } : {}),
        ...(normalized?.decoded.tokenAmount ? { tokenAmount: normalized.decoded.tokenAmount } : {}),
        ...((record.simulation?.estimatedFee ?? normalized?.decoded.estimatedFee) ? {
          estimatedFee: record.simulation?.estimatedFee ?? normalized?.decoded.estimatedFee
        } : {}),
        raw: walletJsonInspectable(normalized?.raw ?? record.request.payload) as Record<string, unknown>
      }
    } : {})
  }
}

function agentSummary(
  record: WalletApprovalRecord,
  wallet?: WalletDescriptor,
  includeAddress = true
): Record<string, unknown> {
  const full = summary(record, wallet)
  if (!full.details) return full
  const { raw: _raw, publicAddress, ...details } = full.details
  return {
    ...full,
    details: {
      ...details,
      ...(includeAddress ? { publicAddress } : {})
    }
  }
}

function trustedMessageRaw(input: WalletMessageSigningInput): Record<string, unknown> {
  if (input.kind === 'typed-data') return { typedData: structuredClone(input.typedData) }
  const bytes = Buffer.from(input.message)
  const message: Record<string, unknown> = {
    encoding: 'base64',
    value: bytes.toString('base64')
  }
  try {
    const decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    message.utf8Preview = decoded.slice(0, 4_096)
    if (decoded.length > 4_096) message.utf8PreviewTruncated = true
  } catch {
    // Binary messages remain fully inspectable through their canonical base64 value.
  } finally {
    bytes.fill(0)
  }
  return { message }
}

export class WalletBroker {
  private readonly adapters: Record<WalletChainFamily, WalletChainAdapter>
  private readonly policy = new WalletPolicyEngine()
  private readonly pending = new Map<string, PendingResult>()
  private readonly pendingMessages = new Map<string, WalletMessageSigningInput>()
  private readonly requestExpiryTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly confirmationTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly confirmationInFlight = new Set<string>()
  private readonly confirmationTasks = new Set<Promise<void>>()
  private readonly agentOperations = new Map<string, AgentOperationLifecycle>()
  private readonly evmProviderSessions = new Map<string, EvmProviderSession>()
  private readonly minimumNavigationGeneration = new Map<string, number>()
  private readonly closedTabs = new Set<string>()
  private readonly confirmationShutdown = new AbortController()
  private lifecycleQueue: Promise<void> = Promise.resolve()
  private shutdownPromise: Promise<void> | null = null
  private shuttingDown = false

  constructor(private readonly service: WalletService, private readonly options: WalletBrokerOptions = {}) {
    this.adapters = {
      evm: options.adapters?.evm ?? new EvmWalletAdapter(),
      solana: options.adapters?.solana ?? new SolanaWalletAdapter(),
      tron: options.adapters?.tron ?? new TronWalletAdapter()
    }
    this.resumeSubmittedConfirmations()
  }

  shutdown(): Promise<void> {
    if (this.shutdownPromise) return this.shutdownPromise
    this.shuttingDown = true
    for (const timer of this.confirmationTimers.values()) clearTimeout(timer)
    this.confirmationTimers.clear()
    for (const timer of this.requestExpiryTimers.values()) clearTimeout(timer)
    this.requestExpiryTimers.clear()

    this.shutdownPromise = (async () => {
      await this.lifecycleQueue
      const drained = await this.drainConfirmationTasks()
      if (!drained) {
        this.confirmationShutdown.abort()
        while (this.confirmationTasks.size > 0) {
          await Promise.allSettled([...this.confirmationTasks])
        }
      }
      for (const timer of this.requestExpiryTimers.values()) clearTimeout(timer)
      this.requestExpiryTimers.clear()
      for (const requestId of [...this.pendingMessages.keys()]) this.clearPendingMessage(requestId)
      this.evmProviderSessions.clear()
    })()
    return this.shutdownPromise
  }

  listPending(): WalletRequestSummary[] {
    const wallets = new Map(this.service.list().map((wallet) => [wallet.id, wallet]))
    return this.service.approvals.list().map((record) => {
      const result = summary(record, wallets.get(record.request.walletId))
      const pendingMessage = this.pendingMessages.get(record.id)
      if (result.details && pendingMessage) {
        result.details.raw = { ...result.details.raw, ...trustedMessageRaw(pendingMessage) }
        result.details.method = pendingMessage.kind === 'typed-data' ? 'typed-data-signing' : 'message-signing'
      }
      return result
    })
  }

  listAgentWallets(context: WalletBrokerContext): WalletAgentDescriptor[] {
    return this.service.list()
      .filter((wallet) => walletAllowsWorkspace(wallet, context.workspaceId))
      .map((wallet) => {
        const addressAllowed = this.hasAddressPermission(context, wallet)
        return {
          id: wallet.id,
          name: wallet.name,
          kind: wallet.kind,
          chainFamily: wallet.chainFamily,
          network: {
            id: wallet.network.id,
            name: wallet.network.name,
            environment: wallet.network.environment
          },
          capabilities: [...wallet.capabilities],
          ...(wallet.availableInAllWorkspaces === true ? { availableInAllWorkspaces: true } : {}),
          addressPermission: addressAllowed,
          ...(addressAllowed ? { publicAddress: wallet.publicAddress } : {})
        }
      })
  }

  async agentBalance(context: WalletBrokerContext, walletId: string): Promise<Record<string, unknown>> {
    return this.withAgentOperation(context, async () => {
      const wallet = this.requireAccessibleWallet(context, walletId)
      const permission = await this.ensureAgentAddressPermission(context, wallet)
      if (permission) return { status: 'permission-required', request: permission }
      let balance: string
      try {
        balance = await this.adapters[wallet.chainFamily].balance(wallet)
      } catch {
        throw new Error(`${walletChainName(wallet.chainFamily)} balance lookup failed`)
      }
      this.assertRequestContextActive(context)
      return {
        status: 'ready',
        walletId: wallet.id,
        chainFamily: wallet.chainFamily,
        networkId: wallet.network.id,
        publicAddress: wallet.publicAddress,
        balance
      }
    })
  }

  async prepareAgentTransaction(
    context: WalletBrokerContext,
    walletId: string,
    payload: unknown
  ): Promise<Record<string, unknown>> {
    return this.withAgentOperation(context, async () => {
      const wallet = this.requireAccessibleWallet(context, walletId)
      const permission = await this.ensureAgentAddressPermission(context, wallet)
      if (permission) return { status: 'permission-required', request: permission }
      const adapter = this.adapters[wallet.chainFamily]
      const normalized = await adapter.normalizeTransaction(wallet, payload)
      this.assertRequestContextActive(context)
      const simulation = sanitizedSimulation(await adapter.simulate(wallet, normalized))
      this.assertRequestContextActive(context)
      await this.service.audit.append('transaction-prepared', {
        walletId: wallet.id,
        workspaceId: context.workspaceId,
        origin: context.topLevelOrigin,
        requester: context.requester,
        networkId: wallet.network.id,
        understood: normalized.decoded.understood,
        method: normalized.decoded.method,
        destination: normalized.decoded.destination,
        simulationAttempted: simulation.attempted,
        simulationSuccess: simulation.success,
        estimatedFee: simulation.estimatedFee
      }, this.now().toISOString())
      this.assertRequestContextActive(context)
      return {
        status: 'prepared',
        walletId: wallet.id,
        chainFamily: wallet.chainFamily,
        networkId: wallet.network.id,
        publicAddress: wallet.publicAddress,
        decoded: structuredClone(normalized.decoded),
        simulation: structuredClone(simulation)
      }
    })
  }

  async requestAgentTransaction(
    context: WalletBrokerContext,
    walletId: string,
    payload: unknown,
    broadcast: boolean
  ): Promise<Record<string, unknown>> {
    return this.withAgentOperation(context, async () => {
      const wallet = this.requireAccessibleWallet(context, walletId)
      const permission = await this.ensureAgentAddressPermission(context, wallet)
      if (permission) return { status: 'permission-required', request: permission }
      const request = await this.transactionRequest(context, wallet, payload, broadcast, true)
      this.assertRequestContextActive(context)
      return { status: 'requested', request }
    })
  }

  async requestAgentMessage(
    context: WalletBrokerContext,
    walletId: string,
    message: Uint8Array
  ): Promise<Record<string, unknown>> {
    return this.withAgentOperation(context, async () => {
      const wallet = this.requireAccessibleWallet(context, walletId)
      const permission = await this.ensureAgentAddressPermission(context, wallet)
      if (permission) return { status: 'permission-required', request: permission }
      const request = await this.messageRequest(context, wallet, { kind: 'message', message }, false, true)
      this.assertRequestContextActive(context)
      return { status: 'requested', request }
    })
  }

  agentRequestStatus(context: WalletBrokerContext, requestId: string): Record<string, unknown> {
    const record = this.requireAgentRequest(context, requestId)
    const wallet = this.requireWallet(record.request.walletId)
    return agentSummary(record, wallet, this.hasAddressPermission(context, wallet))
  }

  async cancelAgentRequest(context: WalletBrokerContext, requestId: string): Promise<Record<string, unknown>> {
    const record = this.requireAgentRequest(context, requestId)
    try {
      const cancelled = await this.service.approvals.cancel(record.id, this.now())
      await this.service.audit.append('request-cancelled', {
        requestId, walletId: record.request.walletId, workspaceId: context.workspaceId,
        requester: context.requester, origin: context.topLevelOrigin
      }, this.now().toISOString())
      const wallet = this.requireWallet(record.request.walletId)
      return agentSummary(cancelled, wallet, this.hasAddressPermission(context, wallet))
    } finally {
      if (this.service.approvals.get(requestId)?.status === 'cancelled') {
        this.rejectPending(requestId, new Error('Wallet request was cancelled'))
        this.publish()
      }
    }
  }

  updateWallet(walletId: string, changes: WalletUpdateInput): Promise<WalletDescriptor> {
    return this.queueLifecycle(async () => {
      const validated = WalletUpdateInputSchema.parse(changes)
      try {
        return await this.service.update(walletId, validated)
      } finally {
        this.reconcileEvmProviderSessions()
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
        this.reconcileEvmProviderSessions()
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
        if (!this.service.permissions.get(permissionId)) this.reconcileEvmProviderSessions()
        this.rejectCancelled()
      }
    })
  }

  refreshProviderSessions(): void {
    this.reconcileEvmProviderSessions()
  }

  async providerRequest(context: WalletBrokerContext, input: WalletProviderRequest): Promise<unknown> {
    try {
      const request = WalletProviderRequestSchema.parse(input)
      const wallets = this.accessibleWallets(context, request.family)
      if (request.family === 'evm') return await this.evmRequest(context, wallets, request.method, request.params)
      if (request.family === 'solana') return await this.solanaRequest(context, wallets, request.method, request.params)
      return await this.tronRequest(context, wallets, request.method, request.params)
    } catch (error) {
      throw sanitizedError(error)
    }
  }

  approve(requestId: string): Promise<WalletRequestSummary> {
    return this.queueLifecycle(() => this.approveRequest(requestId))
  }

  private async approveRequest(requestId: string): Promise<WalletRequestSummary> {
    const record = this.service.approvals.get(requestId)
    if (!record) throw new Error('Wallet request not found')
    try {
      await this.service.approvals.approve(record.id, record.request, this.now())
    } catch (error) {
      const current = this.service.approvals.get(record.id)
      if (current?.status === 'expired') {
        const expired = new Error('Wallet request expired before approval')
        try {
          if (record.status !== 'expired') {
            await this.service.audit.append('request-expired', {
              requestId: record.id,
              walletId: record.request.walletId,
              requester: record.request.requester,
              origin: record.request.topLevelOrigin
            }, this.now().toISOString())
          }
        } finally {
          this.rejectPending(record.id, expired)
          this.publish()
        }
        throw expired
      }
      if (current?.status === 'approved') await this.fail(record.id, error)
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
      await this.fail(record.id, error)
      throw sanitizedError(error)
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
    await this.queueLifecycle(async () => {
      try {
        await this.service.approvals.cancelForNavigation(tabId, generation)
      } finally {
        this.rejectCancelled()
      }
    })
  }

  async cancelForTab(tabId: string): Promise<void> {
    this.closedTabs.add(tabId)
    this.clearEvmProviderSessions((session) => session.tabId === tabId)
    await this.queueLifecycle(async () => {
      try {
        await this.service.approvals.cancelForTab(tabId)
      } finally {
        this.rejectCancelled()
      }
    })
  }

  async cancelForWorkspace(workspaceId: string): Promise<void> {
    this.clearEvmProviderSessions((session) => session.workspaceId === workspaceId)
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

  private async evmRequest(context: WalletBrokerContext, wallets: WalletDescriptor[], method: string, params: unknown): Promise<unknown> {
    if (method === 'wallet_switchEthereumChain') {
      const chainId = (paramsArray(params)[0] as { chainId?: unknown } | undefined)?.chainId
      return this.switchEvmChain(context, wallets, chainId)
    }
    if (!wallets.length) {
      if (method === 'eth_accounts') return []
      throw new Error('No wallet is attached to this workspace for the requested chain')
    }
    const activeWallets = this.activeEvmWallets(context, wallets)
    if (method === 'eth_accounts') return this.permittedAccounts(context, activeWallets)
    const wallet = this.selectWallet(activeWallets)
    if (method === 'eth_chainId') return `0x${BigInt(wallet.network.id).toString(16)}`
    if (method === 'eth_requestAccounts') {
      const permitted = this.permittedAccounts(context, activeWallets)
      return permitted.length ? permitted : this.connect(context, wallet)
    }
    if (method === 'eth_sendTransaction' || method === 'eth_signTransaction') {
      const payload = paramsArray(params)[0]
      const requestedFrom = payload && typeof payload === 'object' && !Array.isArray(payload)
        ? (payload as { from?: unknown }).from
        : undefined
      const selected = requestedFrom === undefined
        ? wallet
        : this.selectEvmAccount(activeWallets, requestedFrom)
      this.assertAddressPermission(context, selected, method === 'eth_sendTransaction' ? 'send' : 'sign')
      return this.transactionRequest(context, selected, payload, method === 'eth_sendTransaction')
    }
    if (method === 'personal_sign' || method === 'eth_sign' || method === 'eth_signTypedData_v4') {
      const values = paramsArray(params)
      const addressIndex = method === 'personal_sign' ? 1 : 0
      const messageIndex = method === 'personal_sign' ? 0 : 1
      const requestedAddress = values[addressIndex]
      const selected = this.selectEvmAccount(activeWallets, requestedAddress)
      this.assertAddressPermission(context, selected, 'sign')
      if (method === 'eth_signTypedData_v4') {
        const typedData = typeof values[messageIndex] === 'string' ? JSON.parse(values[messageIndex]) : values[messageIndex]
        return this.messageRequest(context, selected, { kind: 'typed-data', typedData })
      }
      return this.messageRequest(context, selected, {
        kind: 'message', message: this.messageBytes(values[messageIndex])
      }, method === 'eth_sign')
    }
    throw new Error(`Unsupported EVM wallet method: ${method}`)
  }

  private async solanaRequest(context: WalletBrokerContext, wallets: WalletDescriptor[], method: string, params: unknown): Promise<unknown> {
    const wallet = this.selectWallet(wallets)
    if (method === 'connect') {
      const accounts = await this.connect(context, wallet)
      return { accounts: (accounts as string[]).map((value) => ({
        address: value,
        publicKey: getAddressEncoder().encode(address(value)),
        chains: [`solana:${wallet.network.id}`],
        features: ['solana:signTransaction', 'solana:signAndSendTransaction', 'solana:signMessage'],
        label: wallet.name
      })) }
    }
    if (method === 'disconnect') {
      await this.disconnectWallet(context, wallet)
      return undefined
    }
    this.assertAddressPermission(context, wallet, method === 'signAndSendTransaction' ? 'send' : 'sign')
    if (method === 'signTransaction' || method === 'signAllTransactions' || method === 'signAndSendTransaction') {
      const values = paramsArray(params)
      if (!values.length || values.length > 64) throw new Error('Solana wallet request must include between 1 and 64 transactions')
      const legacy = values.every((value) => Boolean(value && typeof value === 'object' && (value as { compatibility?: unknown }).compatibility === 'legacy'))
      const broadcast = method === 'signAndSendTransaction'
      const results: unknown[] = []
      for (const value of values) {
        const input = value && typeof value === 'object' && 'transaction' in value
          ? value
          : { transaction: value, account: wallet.publicAddress, chain: `solana:${wallet.network.id}` }
        const result = await this.transactionRequest(context, wallet, input, broadcast)
        if (broadcast) {
          const signature = getBase58Encoder().encode(String(result))
          results.push(legacy ? String(result) : { signature })
        } else {
          const signedTransaction = this.base64ResultBytes(result, 'Solana signed transaction')
          results.push(legacy ? signedTransaction : { signedTransaction })
        }
      }
      return legacy && method !== 'signAllTransactions' ? results[0] : results
    }
    if (method === 'signMessage') {
      const inputs = paramsArray(params) as Array<{ account?: { address?: unknown } | string; message?: unknown; compatibility?: unknown }>
      if (!inputs.length || inputs.length > 64) throw new Error('Solana wallet request must include between 1 and 64 messages')
      const legacy = inputs.every((input) => input?.compatibility === 'legacy')
      const results: unknown[] = []
      for (const input of inputs) {
        const requestedAddress = typeof input?.account === 'string' ? input.account : input?.account?.address
        if (requestedAddress && requestedAddress !== wallet.publicAddress) throw new Error('Solana message signer does not match the selected wallet')
        const message = this.messageBytes(input?.message)
        const signature = await this.messageRequest(context, wallet, { kind: 'message', message })
        const signatureBytes = this.base64ResultBytes(signature, 'Solana message signature')
        results.push(legacy
          ? { signature: signatureBytes, publicKey: wallet.publicAddress }
          : { signedMessage: Uint8Array.from(message), signature: signatureBytes })
      }
      return legacy ? results[0] : results
    }
    throw new Error(`Unsupported Solana wallet method: ${method}`)
  }

  private async tronRequest(context: WalletBrokerContext, wallets: WalletDescriptor[], method: string, params: unknown): Promise<unknown> {
    if (method === 'eth_accounts') return this.permittedAccounts(context, wallets)
    const wallet = this.selectWallet(wallets)
    if (method === 'eth_requestAccounts') return this.connect(context, wallet)
    if (method === 'wallet_switchEthereumChain') {
      const chainId = (paramsArray(params)[0] as { chainId?: unknown } | undefined)?.chainId
      if (chainId !== wallet.network.id) throw new Error('Requested Tron network is not configured for this workspace wallet')
      return null
    }
    this.assertAddressPermission(context, wallet, method === 'tron_signAndSendTransaction' ? 'send' : 'sign')
    if (method === 'tron_signTransaction' || method === 'tron_signAndSendTransaction') {
      const broadcast = method === 'tron_signAndSendTransaction'
      const result = await this.transactionRequest(context, wallet, paramsArray(params)[0], broadcast)
      if (broadcast) return result
      return this.tronSignedTransaction(result)
    }
    if (method === 'tron_signMessage') {
      const values = paramsArray(params)
      const requestedAddress = values.length > 1 ? values[0] : wallet.publicAddress
      const message = values.length > 1 ? values[1] : values[0]
      if (requestedAddress !== wallet.publicAddress) throw new Error('Tron message signer does not match the selected wallet')
      return this.messageRequest(context, wallet, { kind: 'message', message: this.messageBytes(message) })
    }
    throw new Error(`Unsupported Tron wallet method: ${method}`)
  }

  private async connect(context: WalletBrokerContext, wallet: WalletDescriptor): Promise<unknown> {
    if (this.hasAddressPermission(context, wallet)) return [wallet.publicAddress]
    const record = await this.createAddressPermissionRequest(context, wallet)
    return this.wait(record.id)
  }

  private async transactionRequest(
    context: WalletBrokerContext,
    wallet: WalletDescriptor,
    payload: unknown,
    broadcast: boolean,
    returnSummary = false
  ): Promise<unknown> {
    const adapter = this.adapters[wallet.chainFamily]
    const normalized = await adapter.normalizeTransaction(wallet, payload)
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
          return returnSummary ? agentSummary(current, this.requireWallet(wallet.id)) : this.wait(record.id)
        }
        this.clearRequestExpiry(record.id)
        return returnSummary ? agentSummary(this.service.approvals.get(record.id)!, wallet) : result
      }
      await this.service.approvals.transition(record.id, 'awaiting-human', this.now())
      return returnSummary
        ? agentSummary(this.service.approvals.get(record.id)!, wallet)
        : this.wait(record.id)
    } catch (error) {
      await this.fail(record.id, error)
      throw error
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
      await this.service.audit.append('request-simulated', {
        requestId: record.id, walletId: wallet.id, success: false, attempted: false,
        policyDecision: 'awaiting-human', reason: rawSigning ? 'raw-signing-requires-human' : 'message-signing-requires-human'
      }, this.now().toISOString())
      await this.service.approvals.transition(record.id, 'awaiting-human', this.now())
      return returnSummary
        ? agentSummary(this.service.approvals.get(record.id)!, wallet)
        : this.wait(record.id)
    } catch (error) {
      await this.fail(record.id, error)
      throw error
    }
  }

  private async execute(record: WalletApprovalRecord, activeAgentContext?: WalletBrokerContext): Promise<unknown> {
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
            expiresAt: new Date(this.now().getTime() + 30 * 24 * 60 * 60_000).toISOString()
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
      if (wallet.chainFamily === 'evm') this.rememberEvmProviderAccounts(record, wallet.network.id)
      this.options.onProviderEvent?.(record.request.tabId, {
        family: wallet.chainFamily, event: 'accountsChanged', payload: [wallet.publicAddress]
      })
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
    await this.appendTransactionAudit('transaction-submitted', record, transactionHash)
    this.scheduleConfirmation(record.id)
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
      await this.fail(record.id, error)
      throw error
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
    if (!this.isAgentOperationActive(context)) throw new Error('Wallet requester session is no longer active')
  }

  private isRequestContextActive(context: WalletBrokerContext): boolean {
    const minimumGeneration = this.minimumNavigationGeneration.get(context.tabId)
    return !this.closedTabs.has(context.tabId)
      && (minimumGeneration === undefined || context.navigationGeneration >= minimumGeneration)
      && this.isAgentOperationActive(context)
  }

  private assertRequestContextActive(context: WalletBrokerContext): void {
    this.assertAgentOperationActive(context)
    const minimumGeneration = this.minimumNavigationGeneration.get(context.tabId)
    if (
      this.closedTabs.has(context.tabId)
      || (minimumGeneration !== undefined && context.navigationGeneration < minimumGeneration)
    ) throw new Error('Wallet request page is no longer active')
  }

  private assertRecordPageActive(record: WalletApprovalRecord): void {
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
        this.options.onProviderEvent?.(context.tabId, { family: wallet.chainFamily, event: 'disconnect' })
      } finally {
        this.rejectCancelled()
      }
    })
  }

  private async createAddressPermissionRequest(
    context: WalletBrokerContext,
    wallet: WalletDescriptor
  ): Promise<WalletApprovalRecord> {
    const currentWallet = this.requireAccessibleWallet(context, wallet.id)
    const record = await this.createRequest(context, currentWallet, 'connect-account', 'read', { account: currentWallet.publicAddress })
    try {
      await this.service.approvals.transition(record.id, 'validated', this.now())
      await this.service.approvals.recordSimulation(record.id, { attempted: false, success: false }, this.now())
      await this.service.approvals.transition(record.id, 'simulated', this.now())
      await this.service.approvals.transition(record.id, 'policy-decision', this.now())
      await this.service.approvals.transition(record.id, 'awaiting-human', this.now())
      this.publish()
      return this.service.approvals.get(record.id)!
    } catch (error) {
      await this.fail(record.id, error)
      throw error
    }
  }

  private async ensureAgentAddressPermission(
    context: WalletBrokerContext,
    wallet: WalletDescriptor
  ): Promise<Record<string, unknown> | null> {
    if (this.hasAddressPermission(context, wallet)) return null
    const existing = this.service.approvals.list().find((record) => (
      record.request.operation === 'connect-account'
      && record.request.walletId === wallet.id
      && record.request.workspaceId === context.workspaceId
      && record.request.tabId === context.tabId
      && record.request.navigationGeneration === context.navigationGeneration
      && record.request.topLevelOrigin === context.topLevelOrigin
      && record.request.requester.type === 'agent'
      && record.request.requester.id === context.requester.id
      && ['validated', 'simulated', 'policy-decision', 'awaiting-human'].includes(record.status)
    ))
    const record = existing ?? await this.createAddressPermissionRequest(context, wallet)
    return agentSummary(record, wallet, false)
  }

  private requireAgentRequest(context: WalletBrokerContext, requestId: string): WalletApprovalRecord {
    const record = this.service.approvals.get(requestId)
    if (!record
      || record.request.requester.type !== 'agent'
      || context.requester.type !== 'agent'
      || record.request.requester.id !== context.requester.id
      || record.request.workspaceId !== context.workspaceId
      || record.request.tabId !== context.tabId
      || record.request.navigationGeneration !== context.navigationGeneration
      || record.request.topLevelOrigin !== context.topLevelOrigin) {
      throw new Error('Wallet request not found for this agent, workspace, tab, and navigation')
    }
    return record
  }

  private selectWallet(wallets: WalletDescriptor[]): WalletDescriptor {
    const wallet = wallets.find((entry) => entry.kind !== 'watch-only') ?? wallets[0]
    if (!wallet) throw new Error('No wallet is attached to this workspace for the requested chain')
    return wallet
  }

  private evmProviderSessionKey(context: WalletBrokerContext): string {
    return JSON.stringify([
      context.workspaceId,
      context.tabId,
      context.navigationGeneration,
      context.topLevelOrigin,
      context.requester.type,
      context.requester.id
    ])
  }

  private activeEvmWallets(context: WalletBrokerContext, wallets: WalletDescriptor[]): WalletDescriptor[] {
    const key = this.evmProviderSessionKey(context)
    const existing = this.evmProviderSessions.get(key)
    const fallback = this.selectWallet(wallets)
    const networkId = existing && wallets.some((wallet) => wallet.network.id === existing.networkId)
      ? existing.networkId
      : fallback.network.id
    this.evmProviderSessions.set(key, {
      workspaceId: context.workspaceId,
      tabId: context.tabId,
      navigationGeneration: context.navigationGeneration,
      topLevelOrigin: context.topLevelOrigin,
      requester: structuredClone(context.requester),
      networkId,
      accounts: this.permittedAccounts(context, wallets.filter((wallet) => wallet.network.id === networkId))
    })
    const active = wallets.filter((wallet) => wallet.network.id === networkId)
    const next = this.evmProviderSessions.get(key)!
    if (existing) {
      if (existing.networkId !== networkId) {
        this.options.onProviderEvent?.(context.tabId, {
          family: 'evm', event: 'chainChanged', payload: `0x${BigInt(networkId).toString(16)}`
        })
      }
      if (!isDeepStrictEqual(existing.accounts, next.accounts)) {
        this.options.onProviderEvent?.(context.tabId, {
          family: 'evm', event: 'accountsChanged', payload: [...next.accounts]
        })
      }
    }
    return active
  }

  private switchEvmChain(
    context: WalletBrokerContext,
    wallets: WalletDescriptor[],
    requestedChainId: unknown
  ): null {
    let numericChainId: bigint
    try {
      if (typeof requestedChainId !== 'string') throw new Error('invalid')
      numericChainId = BigInt(requestedChainId)
    } catch {
      throw new Error('Requested EVM chain is invalid')
    }
    const matching = wallets.filter((wallet) => BigInt(wallet.network.id) === numericChainId)
    if (!matching.length) throw new Error('Requested EVM chain is not configured for this workspace wallet')
    const current = this.activeEvmWallets(context, wallets)
    const nextNetworkId = matching[0]!.network.id
    if (current[0]?.network.id === nextNetworkId) return null
    const key = this.evmProviderSessionKey(context)
    this.evmProviderSessions.set(key, {
      workspaceId: context.workspaceId,
      tabId: context.tabId,
      navigationGeneration: context.navigationGeneration,
      topLevelOrigin: context.topLevelOrigin,
      requester: structuredClone(context.requester),
      networkId: nextNetworkId,
      accounts: this.permittedAccounts(context, matching)
    })
    const chainId = `0x${numericChainId.toString(16)}`
    this.options.onProviderEvent?.(context.tabId, { family: 'evm', event: 'chainChanged', payload: chainId })
    this.options.onProviderEvent?.(context.tabId, {
      family: 'evm',
      event: 'accountsChanged',
      payload: this.permittedAccounts(context, matching)
    })
    return null
  }

  private selectEvmAccount(wallets: WalletDescriptor[], requestedAddress: unknown): WalletDescriptor {
    if (typeof requestedAddress !== 'string') {
      throw new Error('EVM transaction signer does not match the selected wallet')
    }
    const normalized = requestedAddress.toLowerCase()
    const wallet = wallets.find((entry) => entry.publicAddress.toLowerCase() === normalized)
    if (!wallet) throw new Error('EVM transaction signer does not match the selected wallet')
    return wallet
  }

  private clearEvmProviderSessions(predicate: (session: EvmProviderSession) => boolean): void {
    for (const [key, session] of this.evmProviderSessions) {
      if (predicate(session)) this.evmProviderSessions.delete(key)
    }
  }

  private rememberEvmProviderAccounts(record: WalletApprovalRecord, networkId: string): void {
    const context: WalletBrokerContext = {
      workspaceId: record.request.workspaceId,
      tabId: record.request.tabId,
      navigationGeneration: record.request.navigationGeneration,
      topLevelOrigin: record.request.topLevelOrigin,
      requester: structuredClone(record.request.requester)
    }
    const key = this.evmProviderSessionKey(context)
    const session = this.evmProviderSessions.get(key)
    if (!session || session.networkId !== networkId) return
    session.accounts = this.permittedAccounts(
      context,
      this.accessibleWallets(context, 'evm').filter((wallet) => wallet.network.id === networkId)
    )
    this.evmProviderSessions.set(key, session)
  }

  private reconcileEvmProviderSessions(): void {
    for (const [key, session] of this.evmProviderSessions) {
      const context: WalletBrokerContext = {
        workspaceId: session.workspaceId,
        tabId: session.tabId,
        navigationGeneration: session.navigationGeneration,
        topLevelOrigin: session.topLevelOrigin,
        requester: structuredClone(session.requester)
      }
      const wallets = this.accessibleWallets(context, 'evm')
      const currentNetworkWallets = wallets.filter((wallet) => wallet.network.id === session.networkId)
      if (currentNetworkWallets.length) {
        const accounts = this.permittedAccounts(context, currentNetworkWallets)
        if (!isDeepStrictEqual(session.accounts, accounts)) {
          session.accounts = [...accounts]
          this.evmProviderSessions.set(key, session)
          this.options.onProviderEvent?.(session.tabId, {
            family: 'evm', event: 'accountsChanged', payload: accounts
          })
        }
        continue
      }
      if (!wallets.length) {
        this.evmProviderSessions.delete(key)
        if (session.accounts.length) {
          this.options.onProviderEvent?.(session.tabId, {
            family: 'evm', event: 'accountsChanged', payload: []
          })
        }
        continue
      }
      const fallback = this.selectWallet(wallets)
      session.networkId = fallback.network.id
      session.accounts = this.permittedAccounts(
        context,
        wallets.filter((wallet) => wallet.network.id === fallback.network.id)
      )
      this.evmProviderSessions.set(key, session)
      this.options.onProviderEvent?.(session.tabId, {
        family: 'evm', event: 'chainChanged', payload: `0x${BigInt(fallback.network.id).toString(16)}`
      })
      this.options.onProviderEvent?.(session.tabId, {
        family: 'evm', event: 'accountsChanged',
        payload: [...session.accounts]
      })
    }
  }

  private permittedAccounts(context: WalletBrokerContext, wallets: WalletDescriptor[]): string[] {
    return wallets.filter((wallet) => this.hasAddressPermission(context, wallet)).map((wallet) => wallet.publicAddress)
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

  private messageBytes(value: unknown): Uint8Array {
    if (value instanceof Uint8Array) {
      if (!value.length || value.length > 1_048_576) throw new Error('Wallet message is invalid')
      return Uint8Array.from(value)
    }
    if (typeof value !== 'string' || !value.length) throw new Error('Wallet message is invalid')
    if (/^0x(?:[a-fA-F0-9]{2})+$/.test(value)) return Buffer.from(value.slice(2), 'hex')
    const bytes = Buffer.from(value, 'utf8')
    if (bytes.length > 1_048_576) throw new Error('Wallet message is invalid')
    return bytes
  }

  private base64ResultBytes(value: unknown, label: string): Uint8Array {
    if (typeof value !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) throw new Error(`${label} is invalid`)
    const bytes = Buffer.from(value, 'base64')
    if (!bytes.length || bytes.toString('base64') !== value) throw new Error(`${label} is invalid`)
    return Uint8Array.from(bytes)
  }

  private tronSignedTransaction(value: unknown): Record<string, unknown> {
    const bytes = this.base64ResultBytes(value, 'Signed Tron transaction')
    try {
      const parsed = JSON.parse(Buffer.from(bytes).toString('utf8')) as unknown
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid')
      return parsed as Record<string, unknown>
    } catch {
      throw new Error('Signed Tron transaction is invalid')
    } finally {
      bytes.fill(0)
    }
  }

  private async fail(requestId: string, error: unknown): Promise<void> {
    const record = this.service.approvals.get(requestId)
    const failure = sanitizedError(error)
    try {
      if (record && !TERMINAL_REQUEST_STATUSES.has(record.status)) {
        await this.service.approvals.transition(requestId, 'failed', this.now())
        await this.service.audit.append('request-failed', { requestId, error: failure.message }, this.now().toISOString())
      }
    } finally {
      this.rejectPending(requestId, failure)
      this.publish()
    }
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

  private resumeSubmittedConfirmations(): void {
    for (const record of this.service.approvals.list()) {
      if (record.status === 'submitted' && record.transactionHash) this.scheduleConfirmation(record.id)
    }
  }

  private scheduleConfirmation(requestId: string, delay = 0): void {
    if (this.shuttingDown) return
    if (this.confirmationTimers.has(requestId) || this.confirmationInFlight.has(requestId)) return
    const timer = setTimeout(() => {
      this.confirmationTimers.delete(requestId)
      if (this.shuttingDown) return
      const task = this.pollConfirmation(requestId)
      this.confirmationTasks.add(task)
      void task.finally(() => this.confirmationTasks.delete(task)).catch(() => undefined)
    }, delay)
    timer.unref()
    this.confirmationTimers.set(requestId, timer)
  }

  private async pollConfirmation(requestId: string): Promise<void> {
    if (this.confirmationInFlight.has(requestId)) return
    this.confirmationInFlight.add(requestId)
    let retry = false
    try {
      const record = this.service.approvals.get(requestId)
      if (record?.status !== 'submitted' || !record.transactionHash) return
      const wallet = this.service.list().find((entry) => entry.id === record.request.walletId)
      if (!wallet) {
        retry = true
        return
      }
      const confirmation = await this.withConfirmationShutdown(
        this.adapters[wallet.chainFamily].confirmation(wallet, record.transactionHash)
      )
      const current = this.service.approvals.get(requestId)
      if (current?.status !== 'submitted') return
      if (confirmation.confirmed || confirmation.failed) {
        const terminalStatus = confirmation.confirmed ? 'confirmed' : 'failed'
        try {
          await this.service.approvals.transition(requestId, terminalStatus, this.now())
        } finally {
          if (this.service.approvals.get(requestId)?.status === terminalStatus) {
            await this.appendTransactionAudit(
              confirmation.confirmed ? 'transaction-confirmed' : 'transaction-failed',
              record,
              record.transactionHash,
              confirmation.blockReference
            )
          }
          this.publish()
        }
        return
      }
      retry = true
    } catch {
      retry = !this.shuttingDown && this.service.approvals.get(requestId)?.status === 'submitted'
    } finally {
      this.confirmationInFlight.delete(requestId)
      if (retry && this.service.approvals.get(requestId)?.status === 'submitted') {
        this.scheduleConfirmation(requestId, this.confirmationPollIntervalMs())
      }
    }
  }

  private drainConfirmationTasks(): Promise<boolean> {
    if (this.confirmationTasks.size === 0) return Promise.resolve(true)
    return new Promise((resolve) => {
      let settled = false
      const finish = (drained: boolean): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve(drained)
      }
      const timer = setTimeout(() => finish(false), this.shutdownDrainTimeoutMs())
      timer.unref()
      void Promise.allSettled([...this.confirmationTasks]).then(() => finish(true))
    })
  }

  private withConfirmationShutdown<T>(operation: Promise<T>): Promise<T> {
    const signal = this.confirmationShutdown.signal
    if (signal.aborted) return Promise.reject(new Error('Wallet broker is shutting down'))
    return new Promise<T>((resolve, reject) => {
      let settled = false
      const finish = (callback: (value: never) => void, value: unknown): void => {
        if (settled) return
        settled = true
        signal.removeEventListener('abort', onAbort)
        callback(value as never)
      }
      const onAbort = (): void => finish(reject, new Error('Wallet broker is shutting down'))
      signal.addEventListener('abort', onAbort, { once: true })
      void operation.then(
        (value) => finish(resolve, value),
        (error: unknown) => finish(reject, error)
      )
    })
  }

  private shutdownDrainTimeoutMs(): number {
    const configured = this.options.shutdownDrainTimeoutMs
    return Number.isFinite(configured) && configured !== undefined && configured >= 0
      ? configured
      : DEFAULT_SHUTDOWN_DRAIN_TIMEOUT_MS
  }

  private async appendTransactionAudit(
    type: 'transaction-submitted' | 'transaction-confirmed' | 'transaction-failed',
    record: WalletApprovalRecord,
    transactionHash: string,
    blockReference?: string
  ): Promise<void> {
    try {
      await this.service.audit.append(type, {
        requestId: record.id,
        walletId: record.request.walletId,
        workspaceId: record.request.workspaceId,
        origin: record.request.topLevelOrigin,
        requester: record.request.requester,
        networkId: record.request.networkId,
        transactionHash,
        ...(blockReference ? { blockReference } : {})
      }, this.now().toISOString())
    } catch {
      console.error('[wallet] Failed to persist transaction lifecycle audit event')
    }
  }

  private scheduleRequestExpiry(record: WalletApprovalRecord): void {
    this.clearRequestExpiry(record.id)
    const delay = Math.max(0, Date.parse(record.request.expiresAt) - this.now().getTime())
    const timer = setTimeout(() => {
      this.requestExpiryTimers.delete(record.id)
      void this.queueLifecycle(() => this.expireRequest(record.id)).catch(() => undefined)
    }, delay)
    timer.unref()
    this.requestExpiryTimers.set(record.id, timer)
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
    const timer = this.requestExpiryTimers.get(requestId)
    if (timer) clearTimeout(timer)
    this.requestExpiryTimers.delete(requestId)
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
