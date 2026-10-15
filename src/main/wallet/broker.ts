import { createHash, randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { address, getAddressEncoder, getBase58Encoder } from '@solana/kit'
import type {
  WalletAgentDescriptor,
  WalletChainFamily,
  WalletDescriptor,
  WalletMessageWarning,
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
  WALLET_MESSAGE_DISPLAY_MAX_LENGTH,
  WALLET_PROVIDER_METHODS,
  WalletProviderRequestSchema,
  WalletUpdateInputSchema,
  walletAllowsWorkspace
} from '../../shared/wallet.js'
import { normalizeTronProviderChainId, tronProviderChainId } from '../../shared/tron-chain-id.js'
import { signWalletPayload, type WalletMessageSigningInput } from './accounts.js'
import type { WalletApprovalRecord } from './approvals.js'
import { EvmWalletAdapter } from './adapters/evm.js'
import {
  callBundleError,
  callBundleStatus,
  callReceipt,
  EVM_CALL_BUNDLE_VERSION,
  EvmCallBundleStore,
  parseSendCalls,
  type EvmCallReceipt
} from './evm-call-bundles.js'
import { simulationRevertFromStored, storedSimulationRevert } from './evm-revert.js'
import { EvmFilterRegistry, isEvmFilterCreateMethod, isEvmFilterId, MAX_EVM_FILTERS_PER_PAGE, type EvmFilterOwner } from './evm-filters.js'
import {
  EvmAssetSuggestionLog,
  parseWatchAsset,
  watchAssetRefusal,
  withHiddenWalletAddresses,
  type EvmTokenContractDetails
} from './evm-watch-asset.js'
import { WalletPageLog } from './page-log.js'
import { solanaSignInMessage } from './solana-sign-in.js'
import { typedDataDisplay } from './typed-data-display.js'
import { TYPED_DATA_V3_UNSUPPORTED, typedDataV3MatchesV4 } from './typed-data-v3.js'
import { SolanaWalletAdapter } from './adapters/solana.js'
import { TronWalletAdapter } from './adapters/tron.js'
import type {
  WalletChainAdapter,
  WalletNormalizedTransaction,
  WalletTokenBalance,
  WalletTransactionSimulation
} from './adapters/types.js'
import { hasHiddenMessageCharacters, revealHiddenMessageCharacters } from './hidden-characters.js'
import { transactionWarnings } from './transaction-display.js'
import { restoreWalletJson, walletJsonInspectable, walletJsonSafe } from './json-safe.js'
import { recoverPersonalSigner } from './evm-ec-recover.js'
import {
  isMainnetAgentAutomationPolicy,
  isSignInText,
  signInTextWarningIssue,
  websiteSignInPolicyApplies,
  websiteTypedDataPolicyApplies,
  walletPolicyDestinationMatches,
  WalletPolicyEngine,
  type WalletSignInTextIssue,
  type WalletPolicyDecision,
  type WalletWebsiteSignInEvaluation
} from './policy.js'
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

interface AccountProviderSession {
  family: Exclude<WalletChainFamily, 'evm'>
  walletId: string
  workspaceId: string
  tabId: string
  navigationGeneration: number
  topLevelOrigin: string
  requester: WalletRequester
  account: string
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
const MAX_AGENT_PAGE_REQUESTS = 50
/** Failed wallet calls remembered per tab for `wallet_page_requests`; the oldest is dropped first. */
const MAX_PAGE_CALL_FAILURES_PER_TAB = 20
/** Tabs whose failed wallet calls are remembered at once; closing a tab forgets them sooner. */
const MAX_PAGE_CALL_FAILURE_TABS = 256

/** A wallet call a page made that failed, as an agent testing the page sees it. */
interface WalletPageCallFailure {
  family: WalletChainFamily
  /** The method the page called, or `invalid` when it is not a plain method name. */
  method: string
  /** The error the page received, which never holds request parameters or the RPC URL. */
  error: string
  failedAt: string
}

/** Text with each wallet address replaced by the label, the EVM ones in any letter case and with or without 0x. */
function withoutWalletAddresses(text: string, addresses: string[], label: string): string {
  return addresses.reduce((result, address) => (
    /^0x[0-9a-fA-F]{40}$/.test(address)
      ? result.replace(new RegExp(`(?:0x)?${address.slice(2)}`, 'gi'), label)
      : result.split(address).join(label)
  ), text)
}
const DEFAULT_CONFIRMATION_POLL_INTERVAL_MS = 5_000
// A batch waits for each call to be mined before preparing the next one.
const EVM_BATCH_CONFIRMATION_POLL_MS = 1_000
const EVM_BATCH_CONFIRMATION_TIMEOUT_MS = 10 * 60_000
const DEFAULT_SHUTDOWN_DRAIN_TIMEOUT_MS = 2_000
const MAX_TIMEOUT_MS = 2_147_483_647
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
    && /^(?:Wallet|EVM|Solana|Tron|Requested|Unsupported|No wallet|Managed wallet|Watch-only|Invalid wallet|Cross-origin|Mainnet|Automatic wallet|Signed (?:EVM|Solana|Tron)|Transaction|Insufficient)[A-Za-z0-9_ .,:'"()/-]{0,480}$/.test(message)
    ? message
    : 'Wallet request failed validation or processing'
  return new Error(safe.slice(0, 512))
}

function walletChainName(family: WalletChainFamily): string {
  if (family === 'evm') return 'EVM'
  return family === 'solana' ? 'Solana' : 'Tron'
}

const SIMULATION_FAILED = 'Wallet transaction simulation failed'

/**
 * The simulation as approval records keep it: adapter error text, which can
 * name the RPC endpoint, becomes a fixed message, or a revert reason read
 * from the revert data, stored in the error text older versions accept.
 */
function sanitizedSimulation(simulation: WalletTransactionSimulation): WalletTransactionSimulation {
  const revert = !simulation.success && simulation.revert ? storedSimulationRevert(simulation.revert) : undefined
  return {
    attempted: simulation.attempted,
    success: simulation.success,
    ...(simulation.estimatedFee && /^\d+(?:\.\d+)?$/.test(simulation.estimatedFee)
      ? { estimatedFee: simulation.estimatedFee }
      : {}),
    ...(revert ? { error: revert } : simulation.error ? { error: SIMULATION_FAILED } : {})
  }
}

/** A recorded simulation for an agent, with its revert reason read back. */
function agentSimulation(simulation: WalletTransactionSimulation): Record<string, unknown> {
  const revert = simulation.success ? undefined : simulationRevertFromStored(simulation.error)
  return {
    attempted: simulation.attempted,
    success: simulation.success,
    ...(simulation.estimatedFee ? { estimatedFee: simulation.estimatedFee } : {}),
    ...(simulation.error ? { error: SIMULATION_FAILED } : {}),
    ...(revert ? { revert } : {})
  }
}

// Size in UTF-8 JSON bytes, as a page sends it; anything unserializable is unbounded.
function jsonBytes(value: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(value) ?? '', 'utf8')
  } catch {
    return Number.POSITIVE_INFINITY
  }
}

function paramsArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : value === undefined ? [] : [value]
}

function isSilentSolanaConnect(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const options = value as { silent?: unknown; onlyIfTrusted?: unknown }
  return options.silent === true || options.onlyIfTrusted === true
}

function summary(record: WalletApprovalRecord, wallet?: WalletDescriptor): WalletRequestSummary {
  const normalized = record.request.payload.normalized
    ? restoreWalletJson(record.request.payload.normalized) as WalletNormalizedTransaction
    : undefined
  const warnings = normalized ? transactionWarnings(normalized.decoded) : []
  const simulationRevert = record.simulation && !record.simulation.success ? simulationRevertFromStored(record.simulation.error) : undefined
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
        ...(simulationRevert ? { simulationRevert } : {}),
        ...(normalized?.decoded.contract ? { contract: normalized.decoded.contract } : {}),
        ...(normalized?.decoded.source ? { source: normalized.decoded.source } : {}),
        ...(normalized?.decoded.destination ? { destination: normalized.decoded.destination } : {}),
        ...(normalized?.decoded.method ? { method: normalized.decoded.method } : {}),
        ...(normalized?.decoded.nativeAmount ? { nativeAmount: normalized.decoded.nativeAmount } : {}),
        ...(normalized?.decoded.tokenAmount ? { tokenAmount: normalized.decoded.tokenAmount } : {}),
        ...((record.simulation?.estimatedFee ?? normalized?.decoded.estimatedFee) ? {
          estimatedFee: record.simulation?.estimatedFee ?? normalized?.decoded.estimatedFee
        } : {}),
        ...(warnings.length ? { transactionWarnings: warnings } : {}),
        raw: walletJsonInspectable(normalized?.raw ?? record.request.payload) as Record<string, unknown>
      }
    } : {})
  }
}

const HIDDEN_WALLET_ADDRESS = 'this wallet (address hidden until account permission)'
/** Hex digits of an address that a shortened message can end with and still be hidden. */
const MIN_HIDDEN_ADDRESS_PREFIX = 4

/** A contract's revert message with an EVM wallet's address hidden, including its start where the message was cut. */
function hideAddressInRevertMessage(message: string, truncated: boolean, publicAddress: string): string {
  const hex = publicAddress.slice(2).toLowerCase()
  const hidden = withoutWalletAddresses(message, [publicAddress], HIDDEN_WALLET_ADDRESS)
  const tail = truncated ? /[0-9a-fA-F]+$/.exec(hidden) : null
  if (!tail) return hidden
  for (let start = tail.index; start <= hidden.length - MIN_HIDDEN_ADDRESS_PREFIX; start += 1) {
    if (!hex.startsWith(hidden.slice(start).toLowerCase())) continue
    return `${hidden.slice(0, hidden.slice(start - 2, start).toLowerCase() === '0x' ? start - 2 : start)}${HIDDEN_WALLET_ADDRESS}`
  }
  return hidden
}

function agentSummary(
  record: WalletApprovalRecord,
  wallet?: WalletDescriptor,
  includeAddress = true
): Record<string, unknown> {
  const full = summary(record, wallet)
  if (!full.details) return full
  const { raw: _raw, publicAddress, ...details } = full.details
  if (!includeAddress) {
    // A request can name the wallet itself, such as a transfer to its own address.
    for (const field of ['contract', 'source', 'destination'] as const) {
      if (walletPolicyDestinationMatches(details.chainFamily, [publicAddress], details[field])) details[field] = HIDDEN_WALLET_ADDRESS
    }
    // A contract can put the calling account in its revert message.
    if (details.simulationRevert?.kind === 'message' && /^0x[0-9a-fA-F]{40}$/.test(publicAddress)) {
      const { message, truncated } = details.simulationRevert
      details.simulationRevert = { ...details.simulationRevert, message: hideAddressInRevertMessage(message, truncated === true, publicAddress) }
    }
  }
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

const SIGN_IN_TEXT_WARNINGS: Record<WalletSignInTextIssue, WalletMessageWarning> = {
  'sign-in-domain-mismatch': 'sign-in-other-site',
  'sign-in-address-mismatch': 'sign-in-other-account',
  'sign-in-chain-mismatch': 'sign-in-other-chain',
  'sign-in-message-unverified': 'sign-in-unverified'
}

/**
 * Readable text of a UTF-8 message for the trusted approval dialog. Hidden
 * characters are shown as [U+XXXX] markers, and sign-in text that names
 * another site, account or chain than this request is flagged. Binary
 * messages and typed data have no text; the raw request shows them.
 */
function trustedMessageDisplay(
  input: WalletMessageSigningInput,
  wallet: WalletDescriptor,
  topLevelOrigin: string
): NonNullable<WalletRequestSummary['details']>['message'] {
  if (input.kind !== 'message') return undefined
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(input.message)
  } catch {
    return undefined
  }
  const warnings: WalletMessageWarning[] = []
  if (hasHiddenMessageCharacters(text)) warnings.push('hidden-characters')
  const signInIssue = isSignInText(text) ? signInTextWarningIssue(text, wallet, topLevelOrigin) : undefined
  if (signInIssue) warnings.push(SIGN_IN_TEXT_WARNINGS[signInIssue])
  const visible = revealHiddenMessageCharacters(text, WALLET_MESSAGE_DISPLAY_MAX_LENGTH)
  return { text: visible.text, ...(visible.truncated ? { truncated: true as const } : {}), warnings }
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
  private readonly confirmationTasks = new Set<Promise<void>>()
  private readonly agentOperations = new Map<string, AgentOperationLifecycle>()
  private readonly evmProviderSessions = new Map<string, EvmProviderSession>()
  private readonly evmFilters = new EvmFilterRegistry((owner, ids) => this.uninstallEvmFilters(owner.wallet, ids))
  private readonly evmCallBundles = new EvmCallBundleStore()
  private readonly evmAssetSuggestions = new EvmAssetSuggestionLog()
  private readonly pageCallFailures = new WalletPageLog<WalletPageCallFailure>(MAX_PAGE_CALL_FAILURES_PER_TAB, MAX_PAGE_CALL_FAILURE_TABS)
  private readonly accountProviderSessions = new Map<string, AccountProviderSession>()
  private readonly minimumNavigationGeneration = new Map<string, number>()
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
    this.resumeSubmittedConfirmations()
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
        const drained = await this.drainConfirmationTasks()
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
    this.reconcileEvmProviderSessions()
    return this.queueLifecycle(async () => {
      try {
        await this.service.approvals.cancelAll()
      } finally {
        this.rejectCancelled()
      }
      return this.service.status()
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

  async agentBalance(context: WalletBrokerContext, walletId: string, token?: string, spender?: string): Promise<Record<string, unknown>> {
    return this.withAgentOperation(context, async () => {
      const wallet = this.requireAccessibleWallet(context, walletId)
      const adapter = this.adapters[wallet.chainFamily]
      if (spender !== undefined && token === undefined) throw new Error('Wallet token spender needs a token')
      if (token !== undefined) {
        if (!adapter.tokenBalance) throw new Error(`${walletChainName(wallet.chainFamily)} token balances are not supported`)
        if (!adapter.validateAddress(token)) throw new Error(`${walletChainName(wallet.chainFamily)} token address is invalid`)
      }
      if (spender !== undefined) {
        if (!adapter.tokenAllowances) throw new Error(`${walletChainName(wallet.chainFamily)} token allowances are not supported`)
        if (!adapter.validateAddress(spender)) throw new Error(`${walletChainName(wallet.chainFamily)} token spender address is invalid`)
      }
      const permission = await this.ensureAgentAddressPermission(context, wallet)
      if (permission) return { status: 'permission-required', request: permission }
      let balance: string
      let tokenBalance: WalletTokenBalance | undefined
      try {
        if (token !== undefined) {
          tokenBalance = spender === undefined
            ? await adapter.tokenBalance!(wallet, token)
            : await adapter.tokenBalance!(wallet, token, spender)
        }
        else balance = await adapter.balance(wallet)
      } catch {
        const lookup = token === undefined ? 'balance' : spender === undefined ? 'token balance' : 'token balance or allowance'
        throw new Error(`${walletChainName(wallet.chainFamily)} ${lookup} lookup failed`)
      }
      this.assertRequestContextActive(context)
      return {
        status: 'ready',
        walletId: wallet.id,
        chainFamily: wallet.chainFamily,
        networkId: wallet.network.id,
        publicAddress: wallet.publicAddress,
        ...(tokenBalance ? { token: tokenBalance } : { balance: balance! })
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
        simulation: agentSimulation(simulation)
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

  /**
   * Requests the current page made itself, so an agent driving a dApp can see what
   * it asked for. Read-only: approval still happens only in trusted Hronaut UI.
   */
  agentPageRequests(context: WalletBrokerContext): Record<string, unknown> {
    if (context.requester.type !== 'agent') throw new Error('Wallet page requests are available only to agents')
    const wallets = new Map(this.service.list().map((wallet) => [wallet.id, wallet]))
    const records = this.service.approvals.list().filter((record) => (
      record.request.requester.type === 'website'
      && record.request.workspaceId === context.workspaceId
      && record.request.tabId === context.tabId
      && record.request.navigationGeneration === context.navigationGeneration
      && record.request.topLevelOrigin === context.topLevelOrigin
    ))
    const requests = records.slice(-MAX_AGENT_PAGE_REQUESTS).map((record) => {
      const wallet = wallets.get(record.request.walletId)
      const result = agentSummary(record, wallet, wallet ? this.hasAddressPermission(context, wallet) : false)
      const pendingMessage = this.pendingMessages.get(record.id)
      const details = result.details as Record<string, unknown> | undefined
      if (details && pendingMessage) details.method = pendingMessage.kind === 'typed-data' ? 'typed-data-signing' : 'message-signing'
      return result
    })
    const hiddenAddresses = [...wallets.values()]
      .filter((wallet) => wallet.chainFamily === 'evm' && !this.hasAddressPermission(context, wallet))
      .map((wallet) => wallet.publicAddress)
    const suggestedAssets = this.evmAssetSuggestions.forPage(context)
      .map((asset) => withHiddenWalletAddresses(asset, hiddenAddresses, HIDDEN_WALLET_ADDRESS))
    const hiddenAccounts = [...wallets.values()]
      .filter((wallet) => !this.hasAddressPermission(context, wallet))
      .map((wallet) => wallet.publicAddress)
    const failedCalls = this.pageCallFailures.forPage(context).map((failure) => ({
      ...failure,
      method: withoutWalletAddresses(failure.method, hiddenAccounts, HIDDEN_WALLET_ADDRESS),
      error: withoutWalletAddresses(failure.error, hiddenAccounts, HIDDEN_WALLET_ADDRESS)
    }))
    return {
      origin: context.topLevelOrigin,
      requests,
      ...(records.length > requests.length ? { omittedOlder: records.length - requests.length } : {}),
      ...(suggestedAssets.length ? { suggestedAssets } : {}),
      ...(failedCalls.length ? { failedCalls } : {})
    }
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
    try {
      if (this.shuttingDown) throw new Error('Wallet broker is shutting down')
      this.assertRequestContextActive(context)
      this.assertSupportedProviderMethod(input)
      const request = WalletProviderRequestSchema.parse(input)
      const wallets = this.accessibleWallets(context, request.family)
      if (request.family === 'evm') return await this.evmRequest(context, wallets, request.method, request.params)
      if (request.family === 'solana') return await this.solanaRequest(context, wallets, request.method, request.params)
      return await this.tronRequest(context, wallets, request.method, request.params)
    } catch (error) {
      const sanitized = sanitizedError(error)
      this.recordPageCallFailure(context, input, sanitized)
      throw sanitized
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
    if (family === 'evm' && ([...EVM_READ_RPC_METHODS, ...EVM_FILTER_RPC_METHODS] as readonly string[]).includes(name)) return
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

  private async evmRequest(context: WalletBrokerContext, wallets: WalletDescriptor[], method: string, params: unknown): Promise<unknown> {
    if (method === 'personal_ecRecover') {
      const values = paramsArray(params)
      return recoverPersonalSigner(this.messageBytes(values[0], 'hex-or-utf8'), values[1])
    }
    if (method === 'wallet_switchEthereumChain' || method === 'wallet_addEthereumChain') {
      const chainId = (paramsArray(params)[0] as { chainId?: unknown } | undefined)?.chainId
      if (method === 'wallet_addEthereumChain') return this.addEvmChain(context, wallets, chainId)
      return this.switchEvmChain(context, wallets, chainId)
    }
    if (!wallets.length) {
      if (method === 'eth_accounts') return []
      if (method === 'wallet_getPermissions') return []
      throw new Error('No wallet is attached to this workspace for the requested chain')
    }
    const activeWallets = this.activeEvmWallets(context, wallets)
    if (method === 'eth_accounts') return this.permittedAccounts(context, activeWallets)
    if (method === 'wallet_getPermissions') return this.evmPermissions(context, this.permittedAccounts(context, activeWallets))
    if (method === 'wallet_revokePermissions') {
      this.assertEthAccountsPermissionRequest(params)
      for (const wallet of wallets.filter((entry) => this.hasAddressPermission(context, entry))) {
        await this.disconnectWallet(context, wallet)
      }
      return null
    }
    const wallet = this.selectWallet(activeWallets)
    if (method === 'eth_chainId') return `0x${BigInt(wallet.network.id).toString(16)}`
    if (method === 'wallet_watchAsset') return this.watchEvmAsset(context, wallet, params)
    if ((EVM_READ_RPC_METHODS as readonly string[]).includes(method)) {
      const adapter = this.adapters.evm
      if (!adapter.readRpc) throw new Error(`Unsupported EVM wallet method: ${method}`)
      return adapter.readRpc(wallet, method, params)
    }
    if ((EVM_FILTER_RPC_METHODS as readonly string[]).includes(method)) return this.evmFilterRequest(context, wallet, method, params)
    if (method === 'wallet_getCapabilities') return this.evmCapabilities(context, wallets, params)
    if (method === 'wallet_sendCalls') return this.sendEvmCalls(context, activeWallets, wallet, params)
    if (method === 'wallet_getCallsStatus') return this.evmCallsStatus(context, params)
    if (method === 'eth_requestAccounts') {
      const permitted = this.permittedAccounts(context, activeWallets)
      return permitted.length ? permitted : this.connect(context, wallet)
    }
    if (method === 'wallet_requestPermissions') {
      this.assertEthAccountsPermissionRequest(params)
      const permitted = this.permittedAccounts(context, activeWallets)
      const accounts = permitted.length ? permitted : await this.connect(context, wallet) as string[]
      return this.evmPermissions(context, accounts)
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
    if (method === 'personal_sign' || method === 'eth_sign' || method === 'eth_signTypedData_v4' || method === 'eth_signTypedData_v3') {
      const values = paramsArray(params)
      const addressIndex = method === 'personal_sign' ? 1 : 0
      const messageIndex = method === 'personal_sign' ? 0 : 1
      const requestedAddress = values[addressIndex]
      const selected = this.selectEvmAccount(activeWallets, requestedAddress)
      this.assertAddressPermission(context, selected, 'sign')
      if (method === 'eth_signTypedData_v4' || method === 'eth_signTypedData_v3') {
        const typedData = typeof values[messageIndex] === 'string' ? JSON.parse(values[messageIndex]) : values[messageIndex]
        if (method === 'eth_signTypedData_v3' && !typedDataV3MatchesV4(typedData)) throw new Error(TYPED_DATA_V3_UNSUPPORTED)
        return this.messageRequest(context, selected, { kind: 'typed-data', typedData })
      }
      return this.messageRequest(context, selected, {
        kind: 'message', message: this.messageBytes(values[messageIndex], 'hex-or-utf8')
      }, method === 'eth_sign')
    }
    throw new Error(`Unsupported EVM wallet method: ${method}`)
  }

  private async solanaRequest(context: WalletBrokerContext, wallets: WalletDescriptor[], method: string, params: unknown): Promise<unknown> {
    const legacy = method.startsWith('legacy_')
    const walletMethod = legacy ? method.slice('legacy_'.length) : method
    const connectedWallet = this.activeAccountProviderWallet(context, 'solana', wallets)
    if (walletMethod === 'disconnect') {
      const wallet = connectedWallet ?? this.preferredPermittedWallet(context, wallets)
      if (wallet) await this.disconnectWallet(context, wallet)
      return undefined
    }
    const permittedWallet = walletMethod === 'connect'
      ? this.preferredPermittedWallet(context, wallets)
      : undefined
    if (walletMethod === 'connect' && isSilentSolanaConnect(params) && !permittedWallet) return { accounts: [] }
    const wallet = connectedWallet ?? permittedWallet ?? this.selectWallet(wallets)
    if (walletMethod === 'connect') {
      const accounts = await this.connect(context, wallet)
      this.trackAccountProviderSession(context, wallet)
      return { accounts: (accounts as string[]).map((value) => ({
        address: value,
        publicKey: getAddressEncoder().encode(address(value)),
        chains: [`solana:${wallet.network.id}`],
        features: [
          ...(wallet.capabilities.includes('sign') ? ['solana:signTransaction', 'solana:signMessage'] : []),
          ...(wallet.capabilities.includes('send') ? ['solana:signAndSendTransaction'] : [])
        ],
        label: wallet.name
      })) }
    }
    this.assertAddressPermission(context, wallet, walletMethod === 'signAndSendTransaction' ? 'send' : 'sign')
    if (walletMethod === 'signIn') {
      const message = new TextEncoder().encode(solanaSignInMessage(paramsArray(params)[0], context.topLevelOrigin, wallet.publicAddress))
      const signature = await this.messageRequest(context, wallet, { kind: 'message', message })
      return {
        account: wallet.publicAddress,
        signedMessage: message,
        signature: this.base64ResultBytes(signature, 'Solana sign-in signature'),
        signatureType: 'ed25519'
      }
    }
    if (walletMethod === 'signTransaction' || walletMethod === 'signAllTransactions' || walletMethod === 'signAndSendTransaction') {
      const values = paramsArray(params)
      if (!values.length || values.length > 64) throw new Error('Solana wallet request must include between 1 and 64 transactions')
      if (legacy && walletMethod !== 'signAllTransactions' && values.length !== 1) {
        throw new Error('Legacy Solana wallet request must include exactly one transaction')
      }
      const broadcast = walletMethod === 'signAndSendTransaction'
      const inputs = values.map((value) => (
        value && typeof value === 'object' && 'transaction' in value
          ? value
          : { transaction: value, account: wallet.publicAddress, chain: `solana:${wallet.network.id}` }
      ))
      if (!legacy) inputs.forEach((input) => this.assertSolanaTransactionInput(wallet, input, broadcast))
      const normalized: WalletNormalizedTransaction[] = []
      for (const input of inputs) {
        normalized.push(await this.adapters.solana.normalizeTransaction(wallet, input))
        this.assertRequestContextActive(context)
      }
      const results: unknown[] = []
      for (const [index, input] of inputs.entries()) {
        const result = await this.transactionRequest(context, wallet, input, broadcast, false, normalized[index])
        if (broadcast) {
          const signature = getBase58Encoder().encode(String(result))
          results.push(legacy ? String(result) : { signature })
        } else {
          const signedTransaction = this.base64ResultBytes(result, 'Solana signed transaction')
          results.push(legacy ? signedTransaction : { signedTransaction })
        }
      }
      return legacy && walletMethod !== 'signAllTransactions' ? results[0] : results
    }
    if (walletMethod === 'signMessage') {
      const inputs = paramsArray(params) as Array<{ account?: { address?: unknown } | string; message?: unknown }>
      if (!inputs.length || inputs.length > 64) throw new Error('Solana wallet request must include between 1 and 64 messages')
      if (legacy && inputs.length !== 1) throw new Error('Legacy Solana wallet request must include exactly one message')
      const messages = inputs.map((input) => {
        const requestedAddress = typeof input?.account === 'string' ? input.account : input?.account?.address
        if ((!legacy || requestedAddress !== undefined) && requestedAddress !== wallet.publicAddress) {
          throw new Error('Solana message signer does not match the selected wallet')
        }
        return this.messageBytes(input?.message)
      })
      const results: unknown[] = []
      for (const message of messages) {
        const signature = await this.messageRequest(context, wallet, { kind: 'message', message })
        const signatureBytes = this.base64ResultBytes(signature, 'Solana message signature')
        results.push(legacy
          ? { signature: signatureBytes, publicKey: wallet.publicAddress }
          : { signedMessage: Uint8Array.from(message), signature: signatureBytes })
      }
      return legacy ? results[0] : results
    }
    throw new Error(`Unsupported Solana wallet method: ${walletMethod}`)
  }

  private assertSolanaTransactionInput(
    wallet: WalletDescriptor,
    input: object,
    requireChain: boolean
  ): void {
    const candidate = input as { account?: unknown; chain?: unknown }
    const requestedAddress = typeof candidate.account === 'string'
      ? candidate.account
      : candidate.account && typeof candidate.account === 'object'
        ? (candidate.account as { address?: unknown }).address
        : undefined
    if (requestedAddress !== wallet.publicAddress) {
      throw new Error('Solana transaction signer does not match the selected wallet')
    }
    const expectedChain = `solana:${wallet.network.id}`
    if (requireChain && candidate.chain === undefined) {
      throw new Error('Solana transaction chain is required')
    }
    if (candidate.chain !== undefined && candidate.chain !== expectedChain) {
      throw new Error('Solana transaction chain does not match the selected wallet')
    }
  }

  private async tronRequest(context: WalletBrokerContext, wallets: WalletDescriptor[], method: string, params: unknown): Promise<unknown> {
    const connectedWallet = this.activeAccountProviderWallet(context, 'tron', wallets)
    const permittedWallet = this.preferredPermittedWallet(context, wallets)
    if (method === 'eth_accounts') {
      const wallet = connectedWallet ?? permittedWallet
      if (wallet && this.trackAccountProviderSession(context, wallet)) {
        this.publishTronConnection(context, wallet)
      }
      return wallet ? [wallet.publicAddress] : []
    }
    const wallet = connectedWallet ?? permittedWallet ?? this.selectWallet(wallets)
    if (method === 'eth_chainId') {
      const chainId = tronProviderChainId(wallet.network.id)
      if (!chainId) throw new Error('Tron provider chain ID is unavailable for the configured network')
      return chainId
    }
    if (method === 'eth_requestAccounts') {
      const accounts = await this.connect(context, wallet)
      if (this.trackAccountProviderSession(context, wallet)) this.publishTronConnection(context, wallet)
      return accounts
    }
    if (method === 'wallet_switchEthereumChain') {
      const requested = (paramsArray(params)[0] as { chainId?: unknown } | undefined)?.chainId
      const chainId = typeof requested === 'string' ? normalizeTronProviderChainId(requested) : undefined
      if (!chainId) throw new Error('Requested Tron chain is invalid')
      if (chainId !== tronProviderChainId(wallet.network.id)) {
        throw new Error('Requested Tron network is not configured for this workspace wallet')
      }
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
        this.reconcileEvmProviderSessions()
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
      // An approved request is about to grant the permission; asking again would prompt the person twice.
      && ['validated', 'simulated', 'policy-decision', 'awaiting-human', 'approved'].includes(record.status)
    ))
    const record = existing ?? (await this.createAddressPermissionRequest(context, wallet)).record
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
    this.scheduleProviderPermissionExpiry()
    const active = wallets.filter((wallet) => wallet.network.id === networkId)
    const next = this.evmProviderSessions.get(key)!
    if (!existing) {
      this.options.onProviderEvent?.(context.tabId, {
        family: 'evm', event: 'connect', payload: { chainId: `0x${BigInt(networkId).toString(16)}` }
      })
    } else {
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

  private addEvmChain(context: WalletBrokerContext, wallets: WalletDescriptor[], requestedChainId: unknown): null {
    try {
      return this.switchEvmChain(context, wallets, requestedChainId)
    } catch (error) {
      if (error instanceof Error && error.message === 'Requested EVM chain is not configured for this workspace wallet') {
        throw new Error('Requested EVM chain was rejected: websites cannot add networks, configure the network on a workspace wallet in Hronaut')
      }
      throw error
    }
  }

  private assertEthAccountsPermissionRequest(params: unknown): void {
    const request = paramsArray(params)[0]
    const keys = request && typeof request === 'object' && !Array.isArray(request) ? Object.keys(request) : []
    if (keys.length !== 1 || keys[0] !== 'eth_accounts') {
      throw new Error('Unsupported EVM wallet permission: only eth_accounts can be requested or revoked')
    }
  }

  private evmPermissions(context: WalletBrokerContext, accounts: string[]): unknown[] {
    if (!accounts.length) return []
    return [{
      invoker: context.topLevelOrigin,
      parentCapability: 'eth_accounts',
      caveats: [{ type: 'restrictReturnedAccounts', value: accounts }]
    }]
  }

  private switchEvmChain(
    context: WalletBrokerContext,
    wallets: WalletDescriptor[],
    requestedChainId: unknown
  ): null {
    let numericChainId: bigint
    try {
      if (typeof requestedChainId !== 'string' || !/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/.test(requestedChainId)) {
        throw new Error('invalid')
      }
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
    this.scheduleProviderPermissionExpiry()
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

  /**
   * Node filters are forwarded like reads, but a page may poll or remove only
   * the filters this tab and site created on this node. Any other ID gets the
   * node's own "filter not found" answer without reaching the node.
   */
  private async evmFilterRequest(context: WalletBrokerContext, wallet: WalletDescriptor, method: string, params: unknown): Promise<unknown> {
    const adapter = this.adapters.evm
    if (!adapter.readRpc) throw new Error(`Unsupported EVM wallet method: ${method}`)
    const owner: EvmFilterOwner = { workspaceId: context.workspaceId, tabId: context.tabId, topLevelOrigin: context.topLevelOrigin, wallet }
    if (isEvmFilterCreateMethod(method)) {
      // ethers and viem read this message as "filters unsupported" and poll eth_getLogs instead.
      const full = new Error(`EVM RPC error (code -32601): the method ${method} does not exist/is not available for this page, which already keeps ${MAX_EVM_FILTERS_PER_PAGE} filters`)
      if (this.evmFilters.isFull(owner)) throw full
      const id = await adapter.readRpc(wallet, method, params)
      if (!isEvmFilterId(id)) throw new Error('EVM RPC read request failed')
      if (this.closedTabs.has(context.tabId) || this.shuttingDown) {
        this.uninstallEvmFilters(wallet, [id])
        return id
      }
      if (!this.evmFilters.add(owner, id)) {
        this.uninstallEvmFilters(wallet, [id])
        throw full
      }
      return id
    }
    const id = paramsArray(params)[0]
    if (!this.evmFilters.owns(owner, id)) {
      if (method === 'eth_uninstallFilter') return false
      throw new Error('EVM RPC error (code -32000): filter not found')
    }
    const result = await adapter.readRpc(wallet, method, params)
    if (method === 'eth_uninstallFilter') this.evmFilters.remove(owner, id)
    return result
  }

  /**
   * EIP-5792 capabilities of a permitted account on each network it is
   * permitted on. Hronaut sends batched calls one at a time, so it reports
   * atomic execution as unsupported.
   */
  private evmCapabilities(context: WalletBrokerContext, wallets: WalletDescriptor[], params: unknown): Record<string, unknown> {
    const [address, chainIds] = paramsArray(params)
    if (typeof address !== 'string') throw callBundleError(-32602, 'wallet_getCapabilities expects an account address')
    const accounts = wallets.filter((entry) => (
      entry.publicAddress.toLowerCase() === address.toLowerCase() && this.hasAddressPermission(context, entry)
    ))
    if (!accounts.length) throw callBundleError(4100, 'Wallet account access must be approved before reading its capabilities')
    const requested = Array.isArray(chainIds)
      ? new Set(chainIds.map((chainId) => typeof chainId === 'string' && /^0x[0-9a-fA-F]{1,64}$/.test(chainId) ? BigInt(chainId).toString() : ''))
      : undefined
    const capabilities: Record<string, unknown> = {}
    for (const account of accounts) {
      if (requested && !requested.has(account.network.id)) continue
      capabilities[`0x${BigInt(account.network.id).toString(16)}`] = { atomic: { status: 'unsupported' } }
    }
    return capabilities
  }

  /**
   * EIP-5792 batch calls, sent one after another as ordinary transactions:
   * each goes through the same approval or policy as `eth_sendTransaction`.
   * Later calls usually depend on earlier ones, such as a swap after its
   * token approval, so each call is prepared only once the one before it is
   * mined and succeeded, and Hronaut stops at the first call that is
   * rejected, fails or reverts. When the first call does not go out, the
   * request fails with that call's error.
   */
  private async sendEvmCalls(
    context: WalletBrokerContext,
    activeWallets: WalletDescriptor[],
    wallet: WalletDescriptor,
    params: unknown
  ): Promise<{ id: string }> {
    const request = parseSendCalls(params)
    if (BigInt(request.chainId).toString() !== wallet.network.id) {
      throw callBundleError(5710, `Chain ${request.chainId} is not this tab's active wallet network`)
    }
    const selected = request.from === undefined ? wallet : this.selectEvmAccount(activeWallets, request.from)
    this.assertAddressPermission(context, selected, 'send')
    const owner = { workspaceId: context.workspaceId, topLevelOrigin: context.topLevelOrigin }
    const started = this.evmCallBundles.start(owner, selected, request.calls.length, request.id)
    if (started === 'duplicate') throw callBundleError(5720, 'This site already sent a batch with this ID')
    if (started === 'full') throw callBundleError(-32005, 'Too many wallet_sendCalls batches are still being sent')
    try {
      for (const [index, call] of request.calls.entries()) {
        const hash = String(await this.transactionRequest(context, selected, {
          from: selected.publicAddress,
          ...(call.to === undefined ? {} : { to: call.to }),
          ...(call.data === undefined ? {} : { data: call.data }),
          ...(call.value === undefined ? {} : { value: call.value })
        }, true))
        started.bundle.hashes.push(hash)
        if (index < request.calls.length - 1 && !await this.evmCallSucceeded(context, selected, hash)) break
      }
    } catch (error) {
      if (!started.bundle.hashes.length) {
        this.evmCallBundles.delete(owner, started.id)
        throw error
      }
    } finally {
      started.bundle.finished = true
    }
    return { id: started.id }
  }

  /**
   * EIP-747 token suggestions, such as a faucet's "Add token to wallet"
   * button. Hronaut keeps no token list to add them to, so it accepts a valid
   * suggestion without a prompt: it moves no funds and reveals no account.
   * Like MetaMask, it refuses an ERC-20 suggestion whose symbol or decimals
   * disagree with the contract. An agent testing the page sees every
   * suggestion, refused or not, with the contract's own values in
   * `wallet_page_requests`.
   */
  private async watchEvmAsset(context: WalletBrokerContext, wallet: WalletDescriptor, params: unknown): Promise<true> {
    const asset = parseWatchAsset(params)
    let contract: EvmTokenContractDetails = {}
    if (asset.type === 'ERC20' && this.adapters.evm.tokenContractDetails) {
      try {
        contract = await this.adapters.evm.tokenContractDetails(wallet, asset.address)
      } catch {
        // As in MetaMask, a contract that cannot be read leaves the page's values unchecked.
      }
      this.assertRequestContextActive(context)
    }
    const refusal = watchAssetRefusal(asset, contract)
    if (context.requester.type === 'website') {
      this.evmAssetSuggestions.add(context, {
        ...asset,
        ...(contract.symbol === undefined ? {} : { contractSymbol: contract.symbol }),
        ...(contract.decimals === undefined ? {} : { contractDecimals: contract.decimals }),
        ...(refusal ? { refused: refusal.reason } : {}),
        networkId: wallet.network.id,
        suggestedAt: this.now().toISOString()
      })
    }
    if (refusal) throw refusal.error
    return true
  }

  /** Waits until a batch call is mined; false when it reverted, the page left, or it was not mined in time. */
  private async evmCallSucceeded(context: WalletBrokerContext, wallet: WalletDescriptor, hash: string): Promise<boolean> {
    const interval = Math.min(this.confirmationPollIntervalMs(), EVM_BATCH_CONFIRMATION_POLL_MS)
    const deadline = this.now().getTime() + EVM_BATCH_CONFIRMATION_TIMEOUT_MS
    while (this.isRequestContextActive(context) && this.now().getTime() < deadline) {
      try {
        const confirmation = await this.adapters.evm.confirmation(wallet, hash)
        if (confirmation.failed) return false
        if (confirmation.confirmed) return true
      } catch {
        // A node that cannot answer yet is asked again.
      }
      await new Promise((resolve) => setTimeout(resolve, interval))
    }
    return false
  }

  private async evmCallsStatus(context: WalletBrokerContext, params: unknown): Promise<unknown> {
    const id = paramsArray(params)[0]
    const bundle = this.evmCallBundles.get({ workspaceId: context.workspaceId, topLevelOrigin: context.topLevelOrigin }, id)
    if (!bundle) throw callBundleError(5730, 'Unknown batch ID')
    if (!this.hasAddressPermission(context, bundle.wallet)) {
      throw callBundleError(4100, 'Wallet account access must be approved before reading this batch')
    }
    const adapter = this.adapters.evm
    if (!adapter.readRpc) throw new Error('Unsupported EVM wallet method: wallet_getCallsStatus')
    const receipts = await Promise.all(bundle.hashes.map(async (hash) => (
      callReceipt(await adapter.readRpc!(bundle.wallet, 'eth_getTransactionReceipt', [hash]))
    )))
    return {
      version: EVM_CALL_BUNDLE_VERSION,
      id,
      chainId: `0x${BigInt(bundle.wallet.network.id).toString(16)}`,
      status: callBundleStatus(bundle, receipts),
      atomic: false,
      receipts: receipts.filter((receipt): receipt is EvmCallReceipt => receipt !== undefined)
    }
  }

  /** Removes filters Hronaut no longer tracks from the node; the node expires any it misses. */
  private uninstallEvmFilters(wallet: WalletDescriptor, ids: string[]): void {
    for (const id of ids) {
      void this.adapters.evm.readRpc?.(wallet, 'eth_uninstallFilter', [id]).catch(() => undefined)
    }
  }

  private clearEvmProviderSessions(predicate: (session: EvmProviderSession) => boolean): void {
    for (const [key, session] of this.evmProviderSessions) {
      if (predicate(session)) this.evmProviderSessions.delete(key)
    }
  }

  private accountProviderSessionKey(context: WalletBrokerContext, family: Exclude<WalletChainFamily, 'evm'>): string {
    return JSON.stringify([
      family,
      context.workspaceId,
      context.tabId,
      context.navigationGeneration,
      context.topLevelOrigin,
      context.requester.type,
      context.requester.id
    ])
  }

  private activeAccountProviderWallet(
    context: WalletBrokerContext,
    family: Exclude<WalletChainFamily, 'evm'>,
    wallets: WalletDescriptor[]
  ): WalletDescriptor | undefined {
    const session = this.accountProviderSessions.get(this.accountProviderSessionKey(context, family))
    return session
      ? wallets.find((wallet) => (
          wallet.id === session.walletId
          && wallet.publicAddress === session.account
          && this.hasAddressPermission(context, wallet)
        ))
      : undefined
  }

  private preferredPermittedWallet(
    context: WalletBrokerContext,
    wallets: WalletDescriptor[]
  ): WalletDescriptor | undefined {
    return wallets.find((wallet) => wallet.kind !== 'watch-only' && this.hasAddressPermission(context, wallet))
      ?? wallets.find((wallet) => this.hasAddressPermission(context, wallet))
  }

  private trackAccountProviderSession(context: WalletBrokerContext, wallet: WalletDescriptor): boolean {
    if (wallet.chainFamily === 'evm') return false
    const key = this.accountProviderSessionKey(context, wallet.chainFamily)
    const existing = this.accountProviderSessions.get(key)
    this.accountProviderSessions.set(key, {
      family: wallet.chainFamily,
      walletId: wallet.id,
      workspaceId: context.workspaceId,
      tabId: context.tabId,
      navigationGeneration: context.navigationGeneration,
      topLevelOrigin: context.topLevelOrigin,
      requester: structuredClone(context.requester),
      account: wallet.publicAddress
    })
    this.scheduleProviderPermissionExpiry()
    return !existing || existing.walletId !== wallet.id || existing.account !== wallet.publicAddress
  }

  private publishTronConnection(context: WalletBrokerContext, wallet: WalletDescriptor): void {
    this.options.onProviderEvent?.(context.tabId, {
      family: 'tron', event: 'accountsChanged', payload: [wallet.publicAddress]
    })
    const chainId = tronProviderChainId(wallet.network.id)
    if (chainId) {
      this.options.onProviderEvent?.(context.tabId, {
        family: 'tron', event: 'connect', payload: { chainId }
      })
    }
  }

  private clearAccountProviderSessions(predicate: (session: AccountProviderSession) => boolean): void {
    for (const [key, session] of this.accountProviderSessions) {
      if (predicate(session)) this.accountProviderSessions.delete(key)
    }
  }

  private reconcileAccountProviderSessions(): void {
    for (const [key, session] of this.accountProviderSessions) {
      const context: WalletBrokerContext = {
        workspaceId: session.workspaceId,
        tabId: session.tabId,
        navigationGeneration: session.navigationGeneration,
        topLevelOrigin: session.topLevelOrigin,
        requester: structuredClone(session.requester)
      }
      const wallet = this.accessibleWallets(context, session.family).find((entry) => entry.id === session.walletId)
      if (wallet?.publicAddress === session.account && this.hasAddressPermission(context, wallet)) continue
      this.accountProviderSessions.delete(key)
      this.options.onProviderEvent?.(session.tabId, {
        family: session.family,
        event: 'accountsChanged',
        payload: []
      })
      this.options.onProviderEvent?.(session.tabId, {
        family: session.family,
        event: 'disconnect',
        ...(session.family === 'tron' ? {
          payload: { code: 4900, message: 'Tron provider disconnected' }
        } : {})
      })
    }
  }

  private reconcileProviderSessions(): void {
    this.reconcileEvmProviderSessions()
    this.reconcileAccountProviderSessions()
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
        this.options.onProviderEvent?.(session.tabId, {
          family: 'evm', event: 'disconnect', payload: {
            code: 1000,
            message: 'EVM provider disconnected'
          }
        })
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
