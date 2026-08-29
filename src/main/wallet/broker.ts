import { createHash, randomUUID } from 'node:crypto'
import { address, getAddressEncoder, getBase58Encoder } from '@solana/kit'
import type {
  WalletChainFamily,
  WalletDescriptor,
  WalletOperation,
  WalletOperationRequest,
  WalletProviderEvent,
  WalletProviderRequest,
  WalletRequester,
  WalletRequestSummary,
  WalletUpdateInput
} from '../../shared/wallet.js'
import { WalletProviderRequestSchema, WalletUpdateInputSchema } from '../../shared/wallet.js'
import { signWalletPayload, type WalletMessageSigningInput } from './accounts.js'
import type { WalletApprovalRecord } from './approvals.js'
import { EvmWalletAdapter } from './adapters/evm.js'
import { SolanaWalletAdapter } from './adapters/solana.js'
import { TronWalletAdapter } from './adapters/tron.js'
import type { WalletChainAdapter, WalletNormalizedTransaction } from './adapters/types.js'
import { restoreWalletJson, walletJsonInspectable, walletJsonSafe } from './json-safe.js'
import { WalletPolicyEngine } from './policy.js'
import type { WalletService } from './service.js'

export interface WalletBrokerContext {
  workspaceId: string
  tabId: string
  navigationGeneration: number
  topLevelOrigin: string
  requester: WalletRequester
}

interface PendingResult {
  resolve(value: unknown): void
  reject(error: Error): void
}

export interface WalletBrokerOptions {
  adapters?: Partial<Record<WalletChainFamily, WalletChainAdapter>>
  now?: () => Date
  requestTtlMs?: number
  onPendingChanged?: (requests: WalletRequestSummary[]) => void
  onProviderEvent?: (tabId: string, event: WalletProviderEvent) => void
}

const DEFAULT_REQUEST_TTL_MS = 5 * 60_000
const EXPIRABLE_REQUEST_STATUSES = new Set([
  'draft', 'validated', 'simulated', 'policy-decision', 'awaiting-human', 'approved'
])
const TERMINAL_REQUEST_STATUSES = new Set([
  'confirmed', 'rejected', 'expired', 'cancelled', 'failed'
])

function sanitizedError(error: unknown): Error {
  const message = error instanceof Error ? error.message : 'Wallet request failed'
  const safe = /^(?:Wallet|EVM|Solana|Tron|Requested|Unsupported|No wallet|Managed wallet|Watch-only|Invalid wallet|Cross-origin|Mainnet|Automatic wallet|Signed (?:EVM|Solana|Tron)|Transaction|RPC|Insufficient)[A-Za-z0-9 .,:'"()/-]{0,480}$/.test(message)
    ? message
    : 'Wallet request failed validation or processing'
  return new Error(safe.slice(0, 512))
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
  private lifecycleQueue: Promise<void> = Promise.resolve()

  constructor(private readonly service: WalletService, private readonly options: WalletBrokerOptions = {}) {
    this.adapters = {
      evm: options.adapters?.evm ?? new EvmWalletAdapter(),
      solana: options.adapters?.solana ?? new SolanaWalletAdapter(),
      tron: options.adapters?.tron ?? new TronWalletAdapter()
    }
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

  listAgentWallets(context: WalletBrokerContext): Array<Record<string, unknown>> {
    return this.service.list()
      .filter((wallet) => wallet.workspaceIds.includes(context.workspaceId))
      .map((wallet) => {
        const addressAllowed = this.hasAddressPermission(context, wallet)
        return {
          id: wallet.id,
          name: wallet.name,
          kind: wallet.kind,
          chainFamily: wallet.chainFamily,
          network: structuredClone(wallet.network),
          capabilities: [...wallet.capabilities],
          addressPermission: addressAllowed,
          ...(addressAllowed ? { publicAddress: wallet.publicAddress } : {})
        }
      })
  }

  async agentBalance(context: WalletBrokerContext, walletId: string): Promise<Record<string, unknown>> {
    const wallet = this.requireAccessibleWallet(context, walletId)
    const permission = await this.ensureAgentAddressPermission(context, wallet)
    if (permission) return { status: 'permission-required', request: permission }
    return {
      status: 'ready',
      walletId: wallet.id,
      chainFamily: wallet.chainFamily,
      networkId: wallet.network.id,
      publicAddress: wallet.publicAddress,
      balance: await this.adapters[wallet.chainFamily].balance(wallet)
    }
  }

  async prepareAgentTransaction(
    context: WalletBrokerContext,
    walletId: string,
    payload: unknown
  ): Promise<Record<string, unknown>> {
    const wallet = this.requireAccessibleWallet(context, walletId)
    const permission = await this.ensureAgentAddressPermission(context, wallet)
    if (permission) return { status: 'permission-required', request: permission }
    const adapter = this.adapters[wallet.chainFamily]
    const normalized = await adapter.normalizeTransaction(wallet, payload)
    const simulation = await adapter.simulate(wallet, normalized)
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
    return {
      status: 'prepared',
      walletId: wallet.id,
      chainFamily: wallet.chainFamily,
      networkId: wallet.network.id,
      publicAddress: wallet.publicAddress,
      decoded: structuredClone(normalized.decoded),
      simulation: structuredClone(simulation)
    }
  }

  async requestAgentTransaction(
    context: WalletBrokerContext,
    walletId: string,
    payload: unknown,
    broadcast: boolean
  ): Promise<Record<string, unknown>> {
    const wallet = this.requireAccessibleWallet(context, walletId)
    const permission = await this.ensureAgentAddressPermission(context, wallet)
    if (permission) return { status: 'permission-required', request: permission }
    const request = await this.transactionRequest(context, wallet, payload, broadcast, true)
    return { status: 'requested', request }
  }

  async requestAgentMessage(
    context: WalletBrokerContext,
    walletId: string,
    message: Uint8Array
  ): Promise<Record<string, unknown>> {
    const wallet = this.requireAccessibleWallet(context, walletId)
    const permission = await this.ensureAgentAddressPermission(context, wallet)
    if (permission) return { status: 'permission-required', request: permission }
    const request = await this.messageRequest(context, wallet, { kind: 'message', message }, false, true)
    return { status: 'requested', request }
  }

  agentRequestStatus(context: WalletBrokerContext, requestId: string): Record<string, unknown> {
    const record = this.requireAgentRequest(context, requestId)
    return agentSummary(record, this.requireWallet(record.request.walletId))
  }

  async cancelAgentRequest(context: WalletBrokerContext, requestId: string): Promise<Record<string, unknown>> {
    const record = this.requireAgentRequest(context, requestId)
    const cancelled = await this.service.approvals.cancel(record.id, this.now())
    await this.service.audit.append('request-cancelled', {
      requestId, walletId: record.request.walletId, workspaceId: context.workspaceId,
      requester: context.requester, origin: context.topLevelOrigin
    }, this.now().toISOString())
    this.pending.get(requestId)?.reject(new Error('Wallet request was cancelled'))
    this.pending.delete(requestId)
    this.clearPendingMessage(requestId)
    this.clearRequestExpiry(requestId)
    this.publish()
    return agentSummary(cancelled, this.requireWallet(record.request.walletId))
  }

  updateWallet(walletId: string, changes: WalletUpdateInput): Promise<WalletDescriptor> {
    return this.queueLifecycle(async () => {
      const validated = WalletUpdateInputSchema.parse(changes)
      const current = this.requireWallet(walletId)
      const nextWorkspaceIds = validated.workspaceIds ?? current.workspaceIds
      const removedWorkspaceIds = current.workspaceIds.filter((workspaceId) => !nextWorkspaceIds.includes(workspaceId))
      const active = this.service.approvals.list().find((record) => (
        record.request.walletId === walletId
        && removedWorkspaceIds.includes(record.request.workspaceId)
        && (record.status === 'signing' || record.status === 'submitted')
      ))
      if (active) throw new Error('Wallet has a signing or submitted request in a detached workspace')
      for (const workspaceId of removedWorkspaceIds) {
        await Promise.all([
          this.service.approvals.cancelForWalletWorkspace(walletId, workspaceId),
          this.service.permissions.revokeForWalletWorkspace(walletId, workspaceId)
        ])
      }
      const updated = await this.service.update(walletId, validated)
      this.rejectCancelled()
      return updated
    })
  }

  removeWallet(walletId: string): Promise<boolean> {
    return this.queueLifecycle(async () => {
      const removed = await this.service.remove(walletId)
      this.rejectCancelled()
      return removed
    })
  }

  revokePermission(permissionId: string): Promise<boolean> {
    return this.queueLifecycle(async () => {
      const permission = this.service.permissions.get(permissionId)
      if (!permission) return false
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
      this.rejectCancelled()
      return revoked
    })
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
        if (record.status !== 'expired') {
          await this.service.audit.append('request-expired', {
            requestId: record.id,
            walletId: record.request.walletId,
            requester: record.request.requester,
            origin: record.request.topLevelOrigin
          }, this.now().toISOString())
        }
        this.pending.get(record.id)?.reject(expired)
        this.pending.delete(record.id)
        this.clearPendingMessage(record.id)
        this.clearRequestExpiry(record.id)
        this.publish()
        throw expired
      }
      throw sanitizedError(error)
    }
    await this.service.audit.append('request-approved', {
      requestId: record.id, walletId: record.request.walletId, approvalHash: record.requestHash,
      requester: record.request.requester, origin: record.request.topLevelOrigin
    }, this.now().toISOString())
    try {
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
    const record = await this.service.approvals.transition(requestId, 'rejected', this.now())
    await this.service.audit.append('request-rejected', {
      requestId, walletId: record.request.walletId, requester: record.request.requester, origin: record.request.topLevelOrigin
    }, this.now().toISOString())
    this.pending.get(requestId)?.reject(new Error('Wallet request was rejected by the user'))
    this.pending.delete(requestId)
    this.clearPendingMessage(requestId)
    this.clearRequestExpiry(requestId)
    this.publish()
    return summary(record, this.service.list().find((wallet) => wallet.id === record.request.walletId))
  }

  async cancelForNavigation(tabId: string, generation: number): Promise<void> {
    await this.queueLifecycle(async () => {
      await this.service.approvals.cancelForNavigation(tabId, generation)
      this.rejectCancelled()
    })
  }

  async cancelForTab(tabId: string): Promise<void> {
    await this.queueLifecycle(async () => {
      await this.service.approvals.cancelForTab(tabId)
      this.rejectCancelled()
    })
  }

  async cancelForWorkspace(workspaceId: string): Promise<void> {
    await this.queueLifecycle(async () => {
      await Promise.all([
        this.service.approvals.cancelForWorkspace(workspaceId),
        this.service.permissions.revokeForWorkspace(workspaceId)
      ])
      this.rejectCancelled()
    })
  }

  async cancelForRequester(requesterId: string): Promise<void> {
    await this.queueLifecycle(async () => {
      await this.service.approvals.cancelForRequester(requesterId)
      this.rejectCancelled()
    })
  }

  private async evmRequest(context: WalletBrokerContext, wallets: WalletDescriptor[], method: string, params: unknown): Promise<unknown> {
    if (method === 'eth_accounts') return this.permittedAccounts(context, wallets)
    const wallet = this.selectWallet(wallets)
    if (method === 'eth_chainId') return `0x${BigInt(wallet.network.id).toString(16)}`
    if (method === 'eth_requestAccounts') return this.connect(context, wallet)
    if (method === 'wallet_switchEthereumChain') {
      const chainId = (paramsArray(params)[0] as { chainId?: unknown } | undefined)?.chainId
      if (typeof chainId !== 'string' || BigInt(chainId) !== BigInt(wallet.network.id)) throw new Error('Requested EVM chain is not configured for this workspace wallet')
      return null
    }
    this.assertAddressPermission(context, wallet, method === 'eth_sendTransaction' ? 'send' : 'sign')
    if (method === 'eth_sendTransaction' || method === 'eth_signTransaction') {
      const payload = paramsArray(params)[0]
      return this.transactionRequest(context, wallet, payload, method === 'eth_sendTransaction')
    }
    if (method === 'personal_sign' || method === 'eth_sign' || method === 'eth_signTypedData_v4') {
      const values = paramsArray(params)
      const addressIndex = method === 'personal_sign' ? 1 : 0
      const messageIndex = method === 'personal_sign' ? 0 : 1
      const requestedAddress = values[addressIndex]
      if (typeof requestedAddress !== 'string' || requestedAddress.toLowerCase() !== wallet.publicAddress.toLowerCase()) {
        throw new Error('EVM message signer does not match the selected wallet')
      }
      if (method === 'eth_signTypedData_v4') {
        const typedData = typeof values[messageIndex] === 'string' ? JSON.parse(values[messageIndex]) : values[messageIndex]
        return this.messageRequest(context, wallet, { kind: 'typed-data', typedData })
      }
      return this.messageRequest(context, wallet, {
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
    const operation: WalletOperation = broadcast ? 'sign-and-send-transaction' : 'sign-transaction'
    const currentWallet = this.requireAccessibleWallet(context, wallet.id)
    this.assertAddressPermission(context, currentWallet, broadcast ? 'send' : 'sign')
    const record = await this.createRequest(context, currentWallet, operation, broadcast ? 'send' : 'sign', {
      normalized: walletJsonSafe(normalized)
    })
    try {
      await this.service.approvals.transition(record.id, 'validated', this.now())
      const simulation = await adapter.simulate(wallet, normalized)
      await this.service.approvals.recordSimulation(record.id, simulation, this.now())
      await this.service.approvals.transition(record.id, 'simulated', this.now())
      await this.service.approvals.transition(record.id, 'policy-decision', this.now())
      const policyUsage = new Map(this.service.policies.list(wallet.id).map((policy) => [
        policy.id,
        this.service.policyUsage.snapshot(policy.id, this.now())
      ]))
      const policies = this.service.policies.list(wallet.id)
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
        const result = await this.queueLifecycle(async () => {
          const current = this.service.approvals.get(record.id)!
          await this.service.approvals.approve(record.id, current.request, this.now())
          return this.execute(this.service.approvals.get(record.id)!)
        })
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
      await this.service.approvals.transition(record.id, 'awaiting-human', this.now())
      await this.service.audit.append('request-simulated', {
        requestId: record.id, walletId: wallet.id, success: false, attempted: false,
        policyDecision: 'awaiting-human', reason: rawSigning ? 'raw-signing-requires-human' : 'message-signing-requires-human'
      }, this.now().toISOString())
      return returnSummary
        ? agentSummary(this.service.approvals.get(record.id)!, wallet)
        : this.wait(record.id)
    } catch (error) {
      await this.fail(record.id, error)
      throw error
    }
  }

  private async execute(record: WalletApprovalRecord): Promise<unknown> {
    if (record.request.operation === 'connect-account') {
      const wallet = this.requireWallet(record.request.walletId)
      if (!wallet.workspaceIds.includes(record.request.workspaceId)) {
        throw new Error('Wallet is no longer attached to the requesting workspace')
      }
      await this.service.permissions.grant({
        walletId: wallet.id, workspaceId: record.request.workspaceId, origin: record.request.topLevelOrigin,
        account: wallet.publicAddress, chainFamily: wallet.chainFamily, networkId: wallet.network.id,
        capabilities: ['read'], requester: record.request.requester,
        expiresAt: new Date(this.now().getTime() + 30 * 24 * 60 * 60_000).toISOString()
      })
      await this.service.approvals.transition(record.id, 'signing', this.now())
      await this.service.approvals.transition(record.id, 'confirmed', this.now())
      this.options.onProviderEvent?.(record.request.tabId, {
        family: wallet.chainFamily, event: 'accountsChanged', payload: [wallet.publicAddress]
      })
      return [wallet.publicAddress]
    }
    const wallet = this.requireWallet(record.request.walletId)
    if (!wallet.workspaceIds.includes(record.request.workspaceId)) {
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
      await this.service.approvals.markSigning(record.id, record.request, this.now())
      try {
        const signature = await this.service.withSecret(wallet.id, (_descriptor, secret) => (
          signWalletPayload(wallet.chainFamily, secret, input, wallet.publicAddress)
        ))
        await this.service.approvals.transition(record.id, 'confirmed', this.now())
        return signature
      } finally {
        this.clearPendingMessage(record.id)
      }
    }
    const restored = restoreWalletJson(record.request.payload.normalized) as WalletNormalizedTransaction
    const adapter = this.adapters[wallet.chainFamily]
    await this.service.approvals.markSigning(record.id, record.request, this.now())
    const signed = await this.service.withSecret(wallet.id, (descriptor, secret) => adapter.sign(descriptor, secret, restored))
    if (record.request.operation === 'sign-transaction') {
      await this.service.approvals.transition(record.id, 'confirmed', this.now())
      return signed
    }
    const transactionHash = await adapter.broadcast(wallet, signed)
    await this.service.approvals.markSubmitted(record.id, transactionHash, this.now())
    void adapter.confirmation(wallet, transactionHash).then(async (confirmation) => {
      if (confirmation.confirmed) await this.service.approvals.transition(record.id, 'confirmed', this.now())
      else if (confirmation.failed) await this.service.approvals.transition(record.id, 'failed', this.now())
      this.publish()
    }).catch(() => undefined)
    return transactionHash
  }

  private async createRequest(
    context: WalletBrokerContext,
    wallet: WalletDescriptor,
    operation: WalletOperation,
    capability: 'read' | 'sign' | 'send',
    payload: Record<string, unknown>
  ): Promise<WalletApprovalRecord> {
    const now = this.now()
    const request: WalletOperationRequest = {
      requestId: randomUUID(), walletId: wallet.id, workspaceId: context.workspaceId, tabId: context.tabId,
      navigationGeneration: context.navigationGeneration, topLevelOrigin: context.topLevelOrigin,
      requester: structuredClone(context.requester), capability, chainFamily: wallet.chainFamily,
      networkId: wallet.network.id, operation, payload,
      expiresAt: new Date(now.getTime() + this.requestTtlMs()).toISOString()
    }
    const record = await this.service.approvals.create(request, `${context.requester.type}:${context.requester.id}:${request.requestId}`, now)
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

  private accessibleWallets(context: WalletBrokerContext, family: WalletChainFamily): WalletDescriptor[] {
    return this.service.list().filter((wallet) => wallet.chainFamily === family && wallet.workspaceIds.includes(context.workspaceId))
  }

  private requireAccessibleWallet(context: WalletBrokerContext, walletId: string): WalletDescriptor {
    const wallet = this.requireWallet(walletId)
    if (!wallet.workspaceIds.includes(context.workspaceId)) {
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
      this.rejectCancelled()
      this.options.onProviderEvent?.(context.tabId, { family: wallet.chainFamily, event: 'disconnect' })
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
      || record.request.tabId !== context.tabId) {
      throw new Error('Wallet request not found for this agent, workspace, and tab')
    }
    return record
  }

  private selectWallet(wallets: WalletDescriptor[]): WalletDescriptor {
    const wallet = wallets.find((entry) => entry.kind !== 'watch-only') ?? wallets[0]
    if (!wallet) throw new Error('No wallet is attached to this workspace for the requested chain')
    return wallet
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
      this.pending.get(requestId)?.reject(failure)
      this.pending.delete(requestId)
      this.clearPendingMessage(requestId)
      this.clearRequestExpiry(requestId)
      this.publish()
    }
  }

  private rejectCancelled(): void {
    for (const record of this.service.approvals.list()) {
      if (record.status !== 'cancelled' && record.status !== 'expired') continue
      this.pending.get(record.id)?.reject(new Error(`Wallet request was ${record.status}`))
      this.pending.delete(record.id)
      this.clearPendingMessage(record.id)
      this.clearRequestExpiry(record.id)
    }
    this.publish()
  }

  private publish(): void {
    this.options.onPendingChanged?.(this.listPending())
  }

  private clearPendingMessage(requestId: string): void {
    const input = this.pendingMessages.get(requestId)
    if (input?.kind === 'message') input.message.fill(0)
    this.pendingMessages.delete(requestId)
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
      this.pending.get(requestId)?.reject(new Error('Wallet request expired'))
      this.pending.delete(requestId)
      this.clearPendingMessage(requestId)
      this.clearRequestExpiry(requestId)
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

  private queueLifecycle<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.lifecycleQueue.then(operation)
    this.lifecycleQueue = result.then(() => undefined, () => undefined)
    return result
  }

  private now(): Date {
    return this.options.now?.() ?? new Date()
  }
}
