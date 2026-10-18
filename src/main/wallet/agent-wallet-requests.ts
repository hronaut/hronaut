import type { WalletAgentDescriptor, WalletChainFamily, WalletDescriptor } from '../../shared/wallet.js'
import { walletAllowsWorkspace } from '../../shared/wallet.js'
import type { WalletMessageSigningInput } from './accounts.js'
import type { WalletApprovalRecord } from './approvals.js'
import { agentCallBundleId, callBundleState, type EvmCallBundleStore } from './evm-call-bundles.js'
import { withHiddenWalletAddresses, type EvmAssetSuggestionLog } from './evm-watch-asset.js'
import type { WalletPageLog } from './page-log.js'
import type { WalletChainAdapter, WalletTokenBalance } from './adapters/types.js'
import type { WalletService } from './service.js'
import type { WalletBrokerContext, WalletPageCallFailure } from './broker.js'
import {
  agentSimulation,
  agentSummary,
  HIDDEN_WALLET_ADDRESS,
  sanitizedSimulation,
  withoutWalletAddresses
} from './request-summary.js'

const MAX_AGENT_PAGE_REQUESTS = 50
/** wallet_sendCalls batches `wallet_page_requests` lists for a site, newest kept. */
const MAX_AGENT_CALL_BATCHES = 20

function walletChainName(family: WalletChainFamily): string {
  if (family === 'evm') return 'EVM'
  return family === 'solana' ? 'Solana' : 'Tron'
}

/**
 * What the agent wallet tools need from the broker, which keeps the
 * requests, permissions, page logs and agent operation lifecycle, so every
 * agent call still runs inside its requester's operation and creates
 * requests through the broker's own approval path.
 */
export interface AgentWalletAccess {
  service: Pick<WalletService, 'approvals' | 'audit' | 'list'>
  adapters: Record<WalletChainFamily, WalletChainAdapter>
  pendingMessages: ReadonlyMap<string, WalletMessageSigningInput>
  evmAssetSuggestions: EvmAssetSuggestionLog
  pageCallFailures: WalletPageLog<WalletPageCallFailure>
  evmCallBundles: EvmCallBundleStore
  /** Lowercase hashes of sent EVM transactions that failed because another transaction replaced them. */
  replacedTransactionHashes: ReadonlySet<string>
  withAgentOperation<T>(context: WalletBrokerContext, operation: () => Promise<T>): Promise<T>
  requireAccessibleWallet(context: WalletBrokerContext, walletId: string): WalletDescriptor
  requireWallet(walletId: string): WalletDescriptor
  hasAddressPermission(context: WalletBrokerContext, wallet: WalletDescriptor): boolean
  assertRequestContextActive(context: WalletBrokerContext): void
  createAddressPermissionRequest(context: WalletBrokerContext, wallet: WalletDescriptor): Promise<{ record: WalletApprovalRecord }>
  transactionRequest(context: WalletBrokerContext, wallet: WalletDescriptor, payload: unknown, broadcast: boolean, returnSummary: boolean): Promise<unknown>
  messageRequest(context: WalletBrokerContext, wallet: WalletDescriptor, input: WalletMessageSigningInput, rawSigning: boolean, returnSummary: boolean): Promise<unknown>
  rejectPending(requestId: string, error: Error): void
  publish(): void
  now(): Date
}

/** The wallets attached to the agent's workspace, with each address only where the agent has account permission. */
export function listAgentWallets(access: AgentWalletAccess, context: WalletBrokerContext): WalletAgentDescriptor[] {
  return access.service.list()
    .filter((wallet) => walletAllowsWorkspace(wallet, context.workspaceId))
    .map((wallet) => {
      const addressAllowed = access.hasAddressPermission(context, wallet)
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

/** A wallet's native or token balance, or token allowance, for an agent; asks for account permission first when needed. */
export async function agentBalance(access: AgentWalletAccess, context: WalletBrokerContext, walletId: string, token?: string, spender?: string): Promise<Record<string, unknown>> {
  return access.withAgentOperation(context, async () => {
    const wallet = access.requireAccessibleWallet(context, walletId)
    const adapter = access.adapters[wallet.chainFamily]
    if (spender !== undefined && token === undefined) throw new Error('Wallet token spender needs a token')
    if (token !== undefined) {
      if (!adapter.tokenBalance) throw new Error(`${walletChainName(wallet.chainFamily)} token balances are not supported`)
      if (!adapter.validateAddress(token)) throw new Error(`${walletChainName(wallet.chainFamily)} token address is invalid`)
    }
    if (spender !== undefined) {
      if (!adapter.tokenAllowances) throw new Error(`${walletChainName(wallet.chainFamily)} token allowances are not supported`)
      if (!adapter.validateAddress(spender)) throw new Error(`${walletChainName(wallet.chainFamily)} token spender address is invalid`)
    }
    const permission = await ensureAgentAddressPermission(access, context, wallet)
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
    access.assertRequestContextActive(context)
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

/** Decodes and simulates a transaction for an agent without creating a request; asks for account permission first when needed. */
export async function prepareAgentTransaction(
  access: AgentWalletAccess,
  context: WalletBrokerContext,
  walletId: string,
  payload: unknown
): Promise<Record<string, unknown>> {
  return access.withAgentOperation(context, async () => {
    const wallet = access.requireAccessibleWallet(context, walletId)
    const permission = await ensureAgentAddressPermission(access, context, wallet)
    if (permission) return { status: 'permission-required', request: permission }
    const adapter = access.adapters[wallet.chainFamily]
    const normalized = await adapter.normalizeTransaction(wallet, payload)
    access.assertRequestContextActive(context)
    const simulation = sanitizedSimulation(await adapter.simulate(wallet, normalized))
    access.assertRequestContextActive(context)
    await access.service.audit.append('transaction-prepared', {
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
    }, access.now().toISOString())
    access.assertRequestContextActive(context)
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

/** Creates an agent's transaction request, which policy or a person approves; asks for account permission first when needed. */
export async function requestAgentTransaction(
  access: AgentWalletAccess,
  context: WalletBrokerContext,
  walletId: string,
  payload: unknown,
  broadcast: boolean
): Promise<Record<string, unknown>> {
  return access.withAgentOperation(context, async () => {
    const wallet = access.requireAccessibleWallet(context, walletId)
    const permission = await ensureAgentAddressPermission(access, context, wallet)
    if (permission) return { status: 'permission-required', request: permission }
    const request = await access.transactionRequest(context, wallet, payload, broadcast, true)
    access.assertRequestContextActive(context)
    return { status: 'requested', request }
  })
}

/** Creates an agent's message signing request, which a person approves; asks for account permission first when needed. */
export async function requestAgentMessage(
  access: AgentWalletAccess,
  context: WalletBrokerContext,
  walletId: string,
  message: Uint8Array
): Promise<Record<string, unknown>> {
  return access.withAgentOperation(context, async () => {
    const wallet = access.requireAccessibleWallet(context, walletId)
    const permission = await ensureAgentAddressPermission(access, context, wallet)
    if (permission) return { status: 'permission-required', request: permission }
    const request = await access.messageRequest(context, wallet, { kind: 'message', message }, false, true)
    access.assertRequestContextActive(context)
    return { status: 'requested', request }
  })
}

/** The current state of a request this agent made from this tab and navigation. */
export function agentRequestStatus(access: AgentWalletAccess, context: WalletBrokerContext, requestId: string): Record<string, unknown> {
  const record = requireAgentRequest(access, context, requestId)
  const wallet = access.requireWallet(record.request.walletId)
  return agentSummary(record, wallet, access.hasAddressPermission(context, wallet))
}

/**
 * Requests the current page made itself, so an agent driving a dApp can see what
 * it asked for. Read-only: approval still happens only in trusted Hronaut UI.
 */
export function agentPageRequests(access: AgentWalletAccess, context: WalletBrokerContext): Record<string, unknown> {
  if (context.requester.type !== 'agent') throw new Error('Wallet page requests are available only to agents')
  const wallets = new Map(access.service.list().map((wallet) => [wallet.id, wallet]))
  const records = access.service.approvals.list().filter((record) => (
    record.request.requester.type === 'website'
    && record.request.workspaceId === context.workspaceId
    && record.request.tabId === context.tabId
    && record.request.navigationGeneration === context.navigationGeneration
    && record.request.topLevelOrigin === context.topLevelOrigin
  ))
  const requests = records.slice(-MAX_AGENT_PAGE_REQUESTS).map((record) => {
    const wallet = wallets.get(record.request.walletId)
    const result = agentSummary(record, wallet, wallet ? access.hasAddressPermission(context, wallet) : false)
    const pendingMessage = access.pendingMessages.get(record.id)
    const details = result.details as Record<string, unknown> | undefined
    if (details && pendingMessage) details.method = pendingMessage.kind === 'typed-data' ? 'typed-data-signing' : 'message-signing'
    return result
  })
  const hiddenAddresses = [...wallets.values()]
    .filter((wallet) => wallet.chainFamily === 'evm' && !access.hasAddressPermission(context, wallet))
    .map((wallet) => wallet.publicAddress)
  const suggestedAssets = access.evmAssetSuggestions.forPage(context)
    .map((asset) => withHiddenWalletAddresses(asset, hiddenAddresses, HIDDEN_WALLET_ADDRESS))
  const hiddenAccounts = [...wallets.values()]
    .filter((wallet) => !access.hasAddressPermission(context, wallet))
    .map((wallet) => wallet.publicAddress)
  const failedCalls = access.pageCallFailures.forPage(context).map((failure) => ({
    ...failure,
    method: withoutWalletAddresses(failure.method, hiddenAccounts, HIDDEN_WALLET_ADDRESS),
    error: withoutWalletAddresses(failure.error, hiddenAccounts, HIDDEN_WALLET_ADDRESS)
  }))
  const callBatches = agentCallBatches(access, context, hiddenAccounts)
  return {
    origin: context.topLevelOrigin,
    requests,
    ...(records.length > requests.length ? { omittedOlder: records.length - requests.length } : {}),
    ...(suggestedAssets.length ? { suggestedAssets } : {}),
    ...(failedCalls.length ? { failedCalls } : {}),
    ...(callBatches.length ? { callBatches } : {})
  }
}

/**
 * The site's wallet_sendCalls batches in this workspace, newest 20, so an
 * agent can see that a batch stopped, at which call and, when the next
 * call could not be sent, why. Each sent call shows its transaction hash
 * and its request's status.
 */
function agentCallBatches(access: AgentWalletAccess, context: WalletBrokerContext, hiddenAccounts: string[]): Array<Record<string, unknown>> {
  const batches = access.evmCallBundles.forSite(context).slice(-MAX_AGENT_CALL_BATCHES)
  if (!batches.length) return []
  const statuses = new Map(access.service.approvals.list().flatMap((record) => (
    record.transactionHash
    && record.request.workspaceId === context.workspaceId
    && record.request.topLevelOrigin === context.topLevelOrigin
      ? [[record.transactionHash.toLowerCase(), record.status] as const]
      : []
  )))
  return batches.map(({ id, bundle }) => ({
    id: withoutWalletAddresses(agentCallBundleId(id), hiddenAccounts, HIDDEN_WALLET_ADDRESS),
    networkId: bundle.wallet.network.id,
    calls: bundle.calls,
    state: callBundleState(bundle),
    transactions: bundle.hashes.map((hash) => ({
      transactionHash: hash,
      status: statuses.get(hash.toLowerCase()) ?? 'unknown',
      ...(access.replacedTransactionHashes.has(hash.toLowerCase()) ? { replaced: true } : {})
    })),
    ...(bundle.error ? { error: withoutWalletAddresses(bundle.error, hiddenAccounts, HIDDEN_WALLET_ADDRESS) } : {})
  }))
}

/** Cancels a request this agent made from this tab and navigation, and settles whatever waits on it. */
export async function cancelAgentRequest(access: AgentWalletAccess, context: WalletBrokerContext, requestId: string): Promise<Record<string, unknown>> {
  const record = requireAgentRequest(access, context, requestId)
  try {
    const cancelled = await access.service.approvals.cancel(record.id, access.now())
    await access.service.audit.append('request-cancelled', {
      requestId, walletId: record.request.walletId, workspaceId: context.workspaceId,
      requester: context.requester, origin: context.topLevelOrigin
    }, access.now().toISOString())
    const wallet = access.requireWallet(record.request.walletId)
    return agentSummary(cancelled, wallet, access.hasAddressPermission(context, wallet))
  } finally {
    if (access.service.approvals.get(requestId)?.status === 'cancelled') {
      access.rejectPending(requestId, new Error('Wallet request was cancelled'))
      access.publish()
    }
  }
}

async function ensureAgentAddressPermission(
  access: AgentWalletAccess,
  context: WalletBrokerContext,
  wallet: WalletDescriptor
): Promise<Record<string, unknown> | null> {
  if (access.hasAddressPermission(context, wallet)) return null
  const existing = access.service.approvals.list().find((record) => (
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
  const record = existing ?? (await access.createAddressPermissionRequest(context, wallet)).record
  return agentSummary(record, wallet, false)
}

function requireAgentRequest(access: AgentWalletAccess, context: WalletBrokerContext, requestId: string): WalletApprovalRecord {
  const record = access.service.approvals.get(requestId)
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
