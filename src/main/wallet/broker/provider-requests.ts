import type { WalletChainFamily, WalletDescriptor, WalletProviderRequest } from '../../../shared/wallet.js'
import {
  EVM_FILTER_RPC_METHODS,
  EVM_READ_RPC_METHODS,
  WALLET_PROVIDER_METHODS,
  WalletProviderRequestSchema
} from '../../../shared/wallet.js'
import { evmRequest, type EvmProviderAccess } from '../evm-provider.js'
import { solanaRequest, tronRequest, type SolanaTronProviderAccess } from '../solana-tron-provider.js'
import type { WalletPageLog } from '../page-log.js'
import type { WalletService } from '../service.js'
import type { WalletBrokerContext, WalletPageCallFailure } from '../broker.js'
import { sanitizedError } from './sanitized-error.js'

/**
 * What website and agent page calls need from the broker, which keeps the
 * calls in progress per tab, the failed-call log and the page providers'
 * state, so every call still passes the broker's shutdown and page checks
 * before a provider answers it, and a tab stays awake while a page waits.
 */
export interface ProviderRequestsAccess {
  service: Pick<WalletService, 'approvals'>
  /** Website wallet calls still in progress, other than node reads, counted per tab. */
  pageCallsInProgress: Map<string, number>
  pageCallFailures: WalletPageLog<WalletPageCallFailure>
  isShuttingDown(): boolean
  isRequestContextActive(context: WalletBrokerContext): boolean
  assertRequestContextActive(context: WalletBrokerContext): void
  accessibleWallets(context: WalletBrokerContext, family: WalletChainFamily): WalletDescriptor[]
  evmProviderAccess(): EvmProviderAccess
  solanaTronProviderAccess(): SolanaTronProviderAccess
  now(): Date
}

/** A read or filter call Hronaut forwards to the EVM node; it never prompts, signs or sends. */
function isEvmNodeRead(input: unknown): boolean {
  const { family, method } = (input ?? {}) as { family?: unknown; method?: unknown }
  return family === 'evm' && typeof method === 'string'
    && ([...EVM_READ_RPC_METHODS, ...EVM_FILTER_RPC_METHODS] as readonly string[]).includes(method)
}

/**
 * Answers a website's or agent's wallet provider call with the provider for
 * its chain. Errors are sanitized before they leave, and a website's failed
 * call is remembered for agents testing the page.
 */
export async function providerRequest(access: ProviderRequestsAccess, context: WalletBrokerContext, input: WalletProviderRequest): Promise<unknown> {
  // Counted before any await, so the tab stays awake while the request is still being prepared.
  const holdsTab = context.requester.type === 'website' && !isEvmNodeRead(input)
  if (holdsTab) access.pageCallsInProgress.set(context.tabId, (access.pageCallsInProgress.get(context.tabId) ?? 0) + 1)
  try {
    if (access.isShuttingDown()) throw new Error('Wallet broker is shutting down')
    access.assertRequestContextActive(context)
    assertSupportedProviderMethod(input)
    const request = WalletProviderRequestSchema.parse(input)
    const wallets = access.accessibleWallets(context, request.family)
    if (request.family === 'evm') return await evmRequest(access.evmProviderAccess(), context, wallets, request.method, request.params)
    if (request.family === 'solana') return await solanaRequest(access.solanaTronProviderAccess(), context, wallets, request.method, request.params)
    return await tronRequest(access.solanaTronProviderAccess(), context, wallets, request.method, request.params)
  } catch (error) {
    const sanitized = sanitizedError(error)
    recordPageCallFailure(access, context, input, sanitized)
    throw sanitized
  } finally {
    if (holdsTab) {
      const inProgress = (access.pageCallsInProgress.get(context.tabId) ?? 1) - 1
      if (inProgress > 0) access.pageCallsInProgress.set(context.tabId, inProgress)
      else access.pageCallsInProgress.delete(context.tabId)
    }
  }
}

/**
 * Whether a page in this tab still waits on the wallet: a wallet call it
 * made that has not returned yet, from the moment it reaches the broker and
 * including a wallet_sendCalls batch still sending calls, or a request not
 * yet signed or sent, such as one an agent made for the tab. Putting the tab
 * to sleep would discard the page that gets the answer, while the request
 * could still be approved and sent.
 */
export function keepsTabAwake(access: ProviderRequestsAccess, tabId: string): boolean {
  return (access.pageCallsInProgress.get(tabId) ?? 0) > 0 || access.service.approvals.hasUnsentForTab(tabId, access.now())
}

/**
 * Remembers a website's failed wallet call, such as an unsupported method or
 * a network it cannot switch to, so an agent testing the page can see why a
 * button did nothing. Reads forwarded to the node are left out: contracts
 * revert them routinely and the page gets the node's answer.
 */
function recordPageCallFailure(access: ProviderRequestsAccess, context: WalletBrokerContext, input: WalletProviderRequest, error: Error): void {
  if (context.requester.type !== 'website' || !access.isRequestContextActive(context)) return
  const { family, method } = (input ?? {}) as { family?: unknown; method?: unknown }
  if (family !== 'evm' && family !== 'solana' && family !== 'tron') return
  const name = typeof method === 'string' && /^[A-Za-z0-9_]{1,128}$/.test(method) ? method : 'invalid'
  if (isEvmNodeRead(input)) return
  access.pageCallFailures.add(context, { family, method: name, error: error.message, failedAt: access.now().toISOString() })
}

/** Refuses a plain method name the page's chain provider does not support, naming the method. */
function assertSupportedProviderMethod(input: unknown): void {
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
