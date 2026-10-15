import { randomBytes } from 'node:crypto'
import { z } from 'zod'
import type { WalletDescriptor } from '../../shared/wallet.js'

/** The EIP-5792 version Hronaut accepts and reports. */
export const EVM_CALL_BUNDLE_VERSION = '2.0.0'
/** Calls one `wallet_sendCalls` request may carry. */
export const MAX_EVM_BUNDLE_CALLS = 10
/** Bundles remembered for `wallet_getCallsStatus`; the oldest is forgotten first. */
export const MAX_EVM_CALL_BUNDLES = 256

/** EIP-5792 status codes. */
export const CALL_BUNDLE_STATUS = { pending: 100, confirmed: 200, reverted: 500, partiallyReverted: 600 } as const

/** An error the page receives with its EIP-5792 or JSON-RPC code. */
export function callBundleError(code: number, message: string): Error {
  return new Error(`EVM RPC error (code ${code}): ${message}`)
}

const Quantity = z.string().regex(/^0x[0-9a-fA-F]{1,64}$/)
const Capabilities = z.record(z.string().max(128), z.unknown())

const CallSchema = z.object({
  to: z.string().max(64).optional(),
  data: z.string().regex(/^0x(?:[0-9a-fA-F]{2})*$/).optional(),
  value: Quantity.optional(),
  capabilities: Capabilities.optional()
})

const SendCallsSchema = z.object({
  version: z.string().max(32),
  id: z.string().min(1).max(4096).optional(),
  from: z.string().max(64).optional(),
  chainId: Quantity,
  atomicRequired: z.boolean(),
  calls: z.array(CallSchema).min(1),
  capabilities: Capabilities.optional()
})

export type EvmSendCalls = z.infer<typeof SendCallsSchema>
export type EvmBundleCall = z.infer<typeof CallSchema>

/**
 * Reads a `wallet_sendCalls` request and refuses what Hronaut cannot do with
 * the code EIP-5792 assigns: it runs calls one after another as separate
 * transactions, so it cannot promise atomic execution or honor a capability
 * the dApp marks as required.
 */
export function parseSendCalls(params: unknown): EvmSendCalls {
  const parsed = SendCallsSchema.safeParse(Array.isArray(params) ? params[0] : undefined)
  if (!parsed.success) throw callBundleError(-32602, 'wallet_sendCalls expects one request with version, chainId, atomicRequired and calls')
  const request = parsed.data
  if (request.version !== EVM_CALL_BUNDLE_VERSION) {
    throw callBundleError(-32602, `wallet_sendCalls version ${request.version} is not supported; use ${EVM_CALL_BUNDLE_VERSION}`)
  }
  if (request.calls.length > MAX_EVM_BUNDLE_CALLS) {
    throw callBundleError(5740, `Hronaut sends at most ${MAX_EVM_BUNDLE_CALLS} calls in one batch`)
  }
  const required = [request.capabilities, ...request.calls.map((call) => call.capabilities)]
    .flatMap((capabilities) => Object.entries(capabilities ?? {}))
    .find(([, capability]) => (capability as { optional?: unknown } | null)?.optional !== true)
  if (required) throw callBundleError(5700, `Hronaut does not support the required capability ${required[0].slice(0, 64)}`)
  if (request.atomicRequired && request.calls.length > 1) {
    throw callBundleError(5760, 'Hronaut sends each call as its own transaction, so it cannot run them atomically')
  }
  return request
}

/** The site a bundle belongs to; another site's ID is unknown to it. */
export interface EvmCallBundleOwner {
  workspaceId: string
  topLevelOrigin: string
}

export interface EvmCallBundle {
  owner: EvmCallBundleOwner
  wallet: WalletDescriptor
  calls: number
  /** One entry per call sent so far: its transaction hash. */
  hashes: string[]
  /** True once Hronaut has stopped sending this bundle's calls. */
  finished: boolean
}

export class EvmCallBundleStore {
  private readonly bundles = new Map<string, EvmCallBundle>()

  /** Starts a bundle, or returns undefined when this site already used the ID. */
  start(owner: EvmCallBundleOwner, wallet: WalletDescriptor, calls: number, requestedId?: string): { id: string; bundle: EvmCallBundle } | undefined {
    const id = requestedId ?? `0x${randomBytes(32).toString('hex')}`
    const key = bundleKey(owner, id)
    if (this.bundles.has(key)) return undefined
    const bundle: EvmCallBundle = { owner, wallet, calls, hashes: [], finished: false }
    this.bundles.set(key, bundle)
    for (const [oldest] of this.bundles) {
      if (this.bundles.size <= MAX_EVM_CALL_BUNDLES) break
      this.bundles.delete(oldest)
    }
    return { id, bundle }
  }

  get(owner: EvmCallBundleOwner, id: unknown): EvmCallBundle | undefined {
    return typeof id === 'string' ? this.bundles.get(bundleKey(owner, id)) : undefined
  }

  delete(owner: EvmCallBundleOwner, id: string): void {
    this.bundles.delete(bundleKey(owner, id))
  }

  clear(predicate: (owner: EvmCallBundleOwner) => boolean): void {
    for (const [key, bundle] of this.bundles) {
      if (predicate(bundle.owner)) this.bundles.delete(key)
    }
  }
}

function bundleKey(owner: EvmCallBundleOwner, id: string): string {
  return JSON.stringify([owner.workspaceId, owner.topLevelOrigin, id])
}

export interface EvmCallReceipt {
  logs: Array<{ address: string; data: string; topics: string[] }>
  status: string
  blockHash: string
  blockNumber: string
  gasUsed: string
  transactionHash: string
}

/** Keeps the receipt fields EIP-5792 reports, or undefined while the transaction is not mined. */
export function callReceipt(value: unknown): EvmCallReceipt | undefined {
  if (value === null || typeof value !== 'object') return undefined
  const receipt = value as Record<string, unknown>
  const text = (field: unknown) => typeof field === 'string' ? field : ''
  const logs = Array.isArray(receipt.logs) ? receipt.logs : []
  return {
    logs: logs.map((log) => {
      const entry = (log ?? {}) as Record<string, unknown>
      return { address: text(entry.address), data: text(entry.data), topics: Array.isArray(entry.topics) ? entry.topics.map(text) : [] }
    }),
    status: text(receipt.status),
    blockHash: text(receipt.blockHash),
    blockNumber: text(receipt.blockNumber),
    gasUsed: text(receipt.gasUsed),
    transactionHash: text(receipt.transactionHash)
  }
}

/**
 * Pending until every sent call is mined; confirmed when every call was sent
 * and succeeded; reverted when none succeeded; otherwise partially reverted,
 * including when Hronaut stopped before sending every call.
 */
export function callBundleStatus(bundle: EvmCallBundle, receipts: Array<EvmCallReceipt | undefined>): number {
  if (!bundle.finished || receipts.some((receipt) => receipt === undefined)) return CALL_BUNDLE_STATUS.pending
  const succeeded = receipts.filter((receipt) => receipt?.status === '0x1').length
  if (succeeded === bundle.calls) return CALL_BUNDLE_STATUS.confirmed
  if (succeeded === 0) return CALL_BUNDLE_STATUS.reverted
  return CALL_BUNDLE_STATUS.partiallyReverted
}
