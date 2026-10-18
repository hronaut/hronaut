import { isDeepStrictEqual } from 'node:util'
import type { WalletChainFamily, WalletDescriptor, WalletRequester } from '../../shared/wallet.js'
import { EVM_FILTER_RPC_METHODS, EVM_READ_RPC_METHODS } from '../../shared/wallet.js'
import type { WalletMessageSigningInput } from './accounts.js'
import {
  callBundleError,
  callBundleStatus,
  callReceipt,
  EVM_CALL_BUNDLE_VERSION,
  parseSendCalls,
  type EvmCallBundleStore,
  type EvmCallReceipt
} from './evm-call-bundles.js'
import { isEvmFilterCreateMethod, isEvmFilterId, MAX_EVM_FILTERS_PER_PAGE, type EvmFilterOwner, type EvmFilterRegistry } from './evm-filters.js'
import { parseWatchAsset, watchAssetRefusal, type EvmAssetSuggestionLog, type EvmTokenContractDetails } from './evm-watch-asset.js'
import { TYPED_DATA_V3_UNSUPPORTED, typedDataV3MatchesV4 } from './typed-data-v3.js'
import { recoverPersonalSigner } from './evm-ec-recover.js'
import type { WalletChainAdapter } from './adapters/types.js'
import type { WalletBrokerContext, WalletBrokerOptions } from './broker.js'

// A batch waits for each call to be mined before preparing the next one.
const EVM_BATCH_CONFIRMATION_POLL_MS = 1_000
const EVM_BATCH_CONFIRMATION_TIMEOUT_MS = 10 * 60_000

/** A page's EVM provider state: the network it is on and the accounts it was last told about. */
export interface EvmProviderSession {
  workspaceId: string
  tabId: string
  navigationGeneration: number
  topLevelOrigin: string
  requester: WalletRequester
  networkId: string
  accounts: string[]
}

/**
 * What the EVM page provider needs from the broker, which keeps the page
 * connections, filters, batches, token suggestions, permissions and request
 * path, so connecting, signing and sending still go through its account
 * permission checks and approvals.
 */
export interface EvmProviderAccess {
  adapters: Record<WalletChainFamily, WalletChainAdapter>
  options: Pick<WalletBrokerOptions, 'onProviderEvent'>
  evmProviderSessions: Map<string, EvmProviderSession>
  evmFilters: EvmFilterRegistry
  evmCallBundles: EvmCallBundleStore
  evmAssetSuggestions: EvmAssetSuggestionLog
  closedTabs: ReadonlySet<string>
  /** Lowercase hashes of sent EVM transactions that failed because another transaction replaced them. */
  replacedTransactionHashes: ReadonlySet<string>
  isShuttingDown(): boolean
  accessibleWallets(context: WalletBrokerContext, family: WalletChainFamily): WalletDescriptor[]
  selectWallet(wallets: WalletDescriptor[]): WalletDescriptor
  hasAddressPermission(context: WalletBrokerContext, wallet: WalletDescriptor): boolean
  assertAddressPermission(context: WalletBrokerContext, wallet: WalletDescriptor, capability: 'sign' | 'send'): void
  isRequestContextActive(context: WalletBrokerContext): boolean
  assertRequestContextActive(context: WalletBrokerContext): void
  scheduleProviderPermissionExpiry(): void
  confirmationPollIntervalMs(): number
  connect(context: WalletBrokerContext, wallet: WalletDescriptor): Promise<unknown>
  disconnectWallet(context: WalletBrokerContext, wallet: WalletDescriptor): Promise<void>
  transactionRequest(context: WalletBrokerContext, wallet: WalletDescriptor, payload: unknown, broadcast: boolean): Promise<unknown>
  messageRequest(context: WalletBrokerContext, wallet: WalletDescriptor, input: WalletMessageSigningInput, rawSigning?: boolean): Promise<unknown>
  messageBytes(value: unknown, encoding?: 'utf8' | 'hex-or-utf8'): Uint8Array
  /** The broker's error for a page or agent, which keeps only known wallet messages and never an RPC URL. */
  sanitizedError(error: unknown): Error
  now(): Date
}

function paramsArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : value === undefined ? [] : [value]
}

/**
 * Answers a page's EIP-1193 call: accounts, permissions and chains, node
 * reads and filters, EIP-5792 batches, token suggestions, and signing or
 * sending through the broker's account permission checks and approvals.
 */
export async function evmRequest(access: EvmProviderAccess, context: WalletBrokerContext, wallets: WalletDescriptor[], method: string, params: unknown): Promise<unknown> {
  if (method === 'personal_ecRecover') {
    const values = paramsArray(params)
    return recoverPersonalSigner(access.messageBytes(values[0], 'hex-or-utf8'), values[1])
  }
  if (method === 'wallet_switchEthereumChain' || method === 'wallet_addEthereumChain') {
    const chainId = (paramsArray(params)[0] as { chainId?: unknown } | undefined)?.chainId
    if (method === 'wallet_addEthereumChain') return addEvmChain(access, context, wallets, chainId)
    return switchEvmChain(access, context, wallets, chainId)
  }
  if (!wallets.length) {
    if (method === 'eth_accounts') return []
    if (method === 'wallet_getPermissions') return []
    throw new Error('No wallet is attached to this workspace for the requested chain')
  }
  const activeWallets = activeEvmWallets(access, context, wallets)
  if (method === 'eth_accounts') return permittedAccounts(access, context, activeWallets)
  if (method === 'wallet_getPermissions') return evmPermissions(context, permittedAccounts(access, context, activeWallets))
  if (method === 'wallet_revokePermissions') {
    assertEthAccountsPermissionRequest(params)
    for (const wallet of wallets.filter((entry) => access.hasAddressPermission(context, entry))) {
      await access.disconnectWallet(context, wallet)
    }
    return null
  }
  const wallet = access.selectWallet(activeWallets)
  if (method === 'eth_chainId') return `0x${BigInt(wallet.network.id).toString(16)}`
  if (method === 'wallet_watchAsset') return watchEvmAsset(access, context, wallet, params)
  if ((EVM_READ_RPC_METHODS as readonly string[]).includes(method)) {
    const adapter = access.adapters.evm
    if (!adapter.readRpc) throw new Error(`Unsupported EVM wallet method: ${method}`)
    return adapter.readRpc(wallet, method, params)
  }
  if ((EVM_FILTER_RPC_METHODS as readonly string[]).includes(method)) return evmFilterRequest(access, context, wallet, method, params)
  if (method === 'wallet_getCapabilities') return evmCapabilities(access, context, wallets, params)
  if (method === 'wallet_sendCalls') return sendEvmCalls(access, context, activeWallets, wallet, params)
  if (method === 'wallet_getCallsStatus') return evmCallsStatus(access, context, params)
  if (method === 'eth_requestAccounts') {
    const permitted = permittedAccounts(access, context, activeWallets)
    return permitted.length ? permitted : access.connect(context, wallet)
  }
  if (method === 'wallet_requestPermissions') {
    assertEthAccountsPermissionRequest(params)
    const permitted = permittedAccounts(access, context, activeWallets)
    const accounts = permitted.length ? permitted : await access.connect(context, wallet) as string[]
    return evmPermissions(context, accounts)
  }
  if (method === 'eth_sendTransaction' || method === 'eth_signTransaction') {
    const payload = paramsArray(params)[0]
    const requestedFrom = payload && typeof payload === 'object' && !Array.isArray(payload)
      ? (payload as { from?: unknown }).from
      : undefined
    const selected = requestedFrom === undefined
      ? wallet
      : selectEvmAccount(activeWallets, requestedFrom)
    access.assertAddressPermission(context, selected, method === 'eth_sendTransaction' ? 'send' : 'sign')
    return access.transactionRequest(context, selected, payload, method === 'eth_sendTransaction')
  }
  if (method === 'personal_sign' || method === 'eth_sign' || method === 'eth_signTypedData_v4' || method === 'eth_signTypedData_v3') {
    const values = paramsArray(params)
    const addressIndex = method === 'personal_sign' ? 1 : 0
    const messageIndex = method === 'personal_sign' ? 0 : 1
    const requestedAddress = values[addressIndex]
    const selected = selectEvmAccount(activeWallets, requestedAddress)
    access.assertAddressPermission(context, selected, 'sign')
    if (method === 'eth_signTypedData_v4' || method === 'eth_signTypedData_v3') {
      const typedData = typeof values[messageIndex] === 'string' ? JSON.parse(values[messageIndex]) : values[messageIndex]
      if (method === 'eth_signTypedData_v3' && !typedDataV3MatchesV4(typedData)) throw new Error(TYPED_DATA_V3_UNSUPPORTED)
      return access.messageRequest(context, selected, { kind: 'typed-data', typedData })
    }
    return access.messageRequest(context, selected, {
      kind: 'message', message: access.messageBytes(values[messageIndex], 'hex-or-utf8')
    }, method === 'eth_sign')
  }
  throw new Error(`Unsupported EVM wallet method: ${method}`)
}

function evmProviderSessionKey(context: WalletBrokerContext): string {
  return JSON.stringify([
    context.workspaceId,
    context.tabId,
    context.navigationGeneration,
    context.topLevelOrigin,
    context.requester.type,
    context.requester.id
  ])
}

function activeEvmWallets(access: EvmProviderAccess, context: WalletBrokerContext, wallets: WalletDescriptor[]): WalletDescriptor[] {
  const key = evmProviderSessionKey(context)
  const existing = access.evmProviderSessions.get(key)
  const fallback = access.selectWallet(wallets)
  const networkId = existing && wallets.some((wallet) => wallet.network.id === existing.networkId)
    ? existing.networkId
    : fallback.network.id
  access.evmProviderSessions.set(key, {
    workspaceId: context.workspaceId,
    tabId: context.tabId,
    navigationGeneration: context.navigationGeneration,
    topLevelOrigin: context.topLevelOrigin,
    requester: structuredClone(context.requester),
    networkId,
    accounts: permittedAccounts(access, context, wallets.filter((wallet) => wallet.network.id === networkId))
  })
  access.scheduleProviderPermissionExpiry()
  const active = wallets.filter((wallet) => wallet.network.id === networkId)
  const next = access.evmProviderSessions.get(key)!
  if (!existing) {
    access.options.onProviderEvent?.(context.tabId, {
      family: 'evm', event: 'connect', payload: { chainId: `0x${BigInt(networkId).toString(16)}` }
    })
  } else {
    if (existing.networkId !== networkId) {
      access.options.onProviderEvent?.(context.tabId, {
        family: 'evm', event: 'chainChanged', payload: `0x${BigInt(networkId).toString(16)}`
      })
    }
    if (!isDeepStrictEqual(existing.accounts, next.accounts)) {
      access.options.onProviderEvent?.(context.tabId, {
        family: 'evm', event: 'accountsChanged', payload: [...next.accounts]
      })
    }
  }
  return active
}

function addEvmChain(access: EvmProviderAccess, context: WalletBrokerContext, wallets: WalletDescriptor[], requestedChainId: unknown): null {
  try {
    return switchEvmChain(access, context, wallets, requestedChainId)
  } catch (error) {
    if (error instanceof Error && error.message === 'Requested EVM chain is not configured for this workspace wallet') {
      throw new Error('Requested EVM chain was rejected: websites cannot add networks, configure the network on a workspace wallet in Hronaut')
    }
    throw error
  }
}

function assertEthAccountsPermissionRequest(params: unknown): void {
  const request = paramsArray(params)[0]
  const keys = request && typeof request === 'object' && !Array.isArray(request) ? Object.keys(request) : []
  if (keys.length !== 1 || keys[0] !== 'eth_accounts') {
    throw new Error('Unsupported EVM wallet permission: only eth_accounts can be requested or revoked')
  }
}

function evmPermissions(context: WalletBrokerContext, accounts: string[]): unknown[] {
  if (!accounts.length) return []
  return [{
    invoker: context.topLevelOrigin,
    parentCapability: 'eth_accounts',
    caveats: [{ type: 'restrictReturnedAccounts', value: accounts }]
  }]
}

function switchEvmChain(
  access: EvmProviderAccess,
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
  const current = activeEvmWallets(access, context, wallets)
  const nextNetworkId = matching[0]!.network.id
  if (current[0]?.network.id === nextNetworkId) return null
  const key = evmProviderSessionKey(context)
  access.evmProviderSessions.set(key, {
    workspaceId: context.workspaceId,
    tabId: context.tabId,
    navigationGeneration: context.navigationGeneration,
    topLevelOrigin: context.topLevelOrigin,
    requester: structuredClone(context.requester),
    networkId: nextNetworkId,
    accounts: permittedAccounts(access, context, matching)
  })
  access.scheduleProviderPermissionExpiry()
  const chainId = `0x${numericChainId.toString(16)}`
  access.options.onProviderEvent?.(context.tabId, { family: 'evm', event: 'chainChanged', payload: chainId })
  access.options.onProviderEvent?.(context.tabId, {
    family: 'evm',
    event: 'accountsChanged',
    payload: permittedAccounts(access, context, matching)
  })
  return null
}

function selectEvmAccount(wallets: WalletDescriptor[], requestedAddress: unknown): WalletDescriptor {
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
async function evmFilterRequest(access: EvmProviderAccess, context: WalletBrokerContext, wallet: WalletDescriptor, method: string, params: unknown): Promise<unknown> {
  const adapter = access.adapters.evm
  if (!adapter.readRpc) throw new Error(`Unsupported EVM wallet method: ${method}`)
  const owner: EvmFilterOwner = { workspaceId: context.workspaceId, tabId: context.tabId, topLevelOrigin: context.topLevelOrigin, wallet }
  if (isEvmFilterCreateMethod(method)) {
    // ethers and viem read this message as "filters unsupported" and poll eth_getLogs instead.
    const full = new Error(`EVM RPC error (code -32601): the method ${method} does not exist/is not available for this page, which already keeps ${MAX_EVM_FILTERS_PER_PAGE} filters`)
    if (access.evmFilters.isFull(owner)) throw full
    const id = await adapter.readRpc(wallet, method, params)
    if (!isEvmFilterId(id)) throw new Error('EVM RPC read request failed')
    if (access.closedTabs.has(context.tabId) || access.isShuttingDown()) {
      uninstallEvmFilters(access, wallet, [id])
      return id
    }
    if (!access.evmFilters.add(owner, id)) {
      uninstallEvmFilters(access, wallet, [id])
      throw full
    }
    return id
  }
  const id = paramsArray(params)[0]
  if (!access.evmFilters.owns(owner, id)) {
    if (method === 'eth_uninstallFilter') return false
    throw new Error('EVM RPC error (code -32000): filter not found')
  }
  const result = await adapter.readRpc(wallet, method, params)
  if (method === 'eth_uninstallFilter') access.evmFilters.remove(owner, id)
  return result
}

/**
 * EIP-5792 capabilities of a permitted account on each network it is
 * permitted on. Hronaut sends batched calls one at a time, so it reports
 * atomic execution as unsupported.
 */
function evmCapabilities(access: EvmProviderAccess, context: WalletBrokerContext, wallets: WalletDescriptor[], params: unknown): Record<string, unknown> {
  const [address, chainIds] = paramsArray(params)
  if (typeof address !== 'string') throw callBundleError(-32602, 'wallet_getCapabilities expects an account address')
  const accounts = wallets.filter((entry) => (
    entry.publicAddress.toLowerCase() === address.toLowerCase() && access.hasAddressPermission(context, entry)
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
async function sendEvmCalls(
  access: EvmProviderAccess,
  context: WalletBrokerContext,
  activeWallets: WalletDescriptor[],
  wallet: WalletDescriptor,
  params: unknown
): Promise<{ id: string }> {
  const request = parseSendCalls(params)
  if (BigInt(request.chainId).toString() !== wallet.network.id) {
    throw callBundleError(5710, `Chain ${request.chainId} is not this tab's active wallet network`)
  }
  const selected = request.from === undefined ? wallet : selectEvmAccount(activeWallets, request.from)
  access.assertAddressPermission(context, selected, 'send')
  const owner = { workspaceId: context.workspaceId, topLevelOrigin: context.topLevelOrigin }
  const started = access.evmCallBundles.start(owner, selected, request.calls.length, request.id)
  if (started === 'duplicate') throw callBundleError(5720, 'This site already sent a batch with this ID')
  if (started === 'full') throw callBundleError(-32005, 'Too many wallet_sendCalls batches are still being sent')
  try {
    for (const [index, call] of request.calls.entries()) {
      const hash = String(await access.transactionRequest(context, selected, {
        from: selected.publicAddress,
        ...(call.to === undefined ? {} : { to: call.to }),
        ...(call.data === undefined ? {} : { data: call.data }),
        ...(call.value === undefined ? {} : { value: call.value })
      }, true))
      started.bundle.hashes.push(hash)
      if (index < request.calls.length - 1 && !await evmCallSucceeded(access, context, selected, hash)) break
    }
  } catch (error) {
    if (!started.bundle.hashes.length) {
      access.evmCallBundles.delete(owner, started.id)
      throw error
    }
    // The page already has its batch ID, so only an agent reading the batch learns why it stopped.
    started.bundle.error = access.sanitizedError(error).message
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
async function watchEvmAsset(access: EvmProviderAccess, context: WalletBrokerContext, wallet: WalletDescriptor, params: unknown): Promise<true> {
  const asset = parseWatchAsset(params)
  let contract: EvmTokenContractDetails = {}
  if (asset.type === 'ERC20' && access.adapters.evm.tokenContractDetails) {
    try {
      contract = await access.adapters.evm.tokenContractDetails(wallet, asset.address)
    } catch {
      // As in MetaMask, a contract that cannot be read leaves the page's values unchecked.
    }
    access.assertRequestContextActive(context)
  }
  const refusal = watchAssetRefusal(asset, contract)
  if (context.requester.type === 'website') {
    access.evmAssetSuggestions.add(context, {
      ...asset,
      ...(contract.symbol === undefined ? {} : { contractSymbol: contract.symbol }),
      ...(contract.decimals === undefined ? {} : { contractDecimals: contract.decimals }),
      ...(refusal ? { refused: refusal.reason } : {}),
      networkId: wallet.network.id,
      suggestedAt: access.now().toISOString()
    })
  }
  if (refusal) throw refusal.error
  return true
}

/**
 * Waits until a batch call is mined; false when it reverted, another
 * transaction replaced it, the page left, or it was not mined in time.
 */
async function evmCallSucceeded(access: EvmProviderAccess, context: WalletBrokerContext, wallet: WalletDescriptor, hash: string): Promise<boolean> {
  const interval = Math.min(access.confirmationPollIntervalMs(), EVM_BATCH_CONFIRMATION_POLL_MS)
  const deadline = access.now().getTime() + EVM_BATCH_CONFIRMATION_TIMEOUT_MS
  while (access.isRequestContextActive(context) && access.now().getTime() < deadline) {
    if (access.replacedTransactionHashes.has(hash.toLowerCase())) return false
    try {
      const confirmation = await access.adapters.evm.confirmation(wallet, hash)
      if (confirmation.failed) return false
      if (confirmation.confirmed) return true
    } catch {
      // A node that cannot answer yet is asked again.
    }
    await new Promise((resolve) => setTimeout(resolve, interval))
  }
  return false
}

async function evmCallsStatus(access: EvmProviderAccess, context: WalletBrokerContext, params: unknown): Promise<unknown> {
  const id = paramsArray(params)[0]
  const bundle = access.evmCallBundles.get({ workspaceId: context.workspaceId, topLevelOrigin: context.topLevelOrigin }, id)
  if (!bundle) throw callBundleError(5730, 'Unknown batch ID')
  if (!access.hasAddressPermission(context, bundle.wallet)) {
    throw callBundleError(4100, 'Wallet account access must be approved before reading this batch')
  }
  const adapter = access.adapters.evm
  if (!adapter.readRpc) throw new Error('Unsupported EVM wallet method: wallet_getCallsStatus')
  const receipts = await Promise.all(bundle.hashes.map(async (hash) => (
    callReceipt(await adapter.readRpc!(bundle.wallet, 'eth_getTransactionReceipt', [hash]))
  )))
  const replaced = bundle.hashes.map((hash, index) => receipts[index] === undefined && access.replacedTransactionHashes.has(hash.toLowerCase()))
  return {
    version: EVM_CALL_BUNDLE_VERSION,
    id,
    chainId: `0x${BigInt(bundle.wallet.network.id).toString(16)}`,
    status: callBundleStatus(bundle, receipts, replaced),
    atomic: false,
    receipts: receipts.filter((receipt): receipt is EvmCallReceipt => receipt !== undefined)
  }
}

/** Removes filters Hronaut no longer tracks from the node; the node expires any it misses. */
export function uninstallEvmFilters(access: EvmProviderAccess, wallet: WalletDescriptor, ids: string[]): void {
  for (const id of ids) {
    void access.adapters.evm.readRpc?.(wallet, 'eth_uninstallFilter', [id]).catch(() => undefined)
  }
}

/**
 * Brings each EVM page connection in line with its wallets and account
 * permissions, moving it to another configured network or disconnecting it,
 * and tells the page what changed.
 */
export function reconcileEvmProviderSessions(access: EvmProviderAccess): void {
  for (const [key, session] of access.evmProviderSessions) {
    const context: WalletBrokerContext = {
      workspaceId: session.workspaceId,
      tabId: session.tabId,
      navigationGeneration: session.navigationGeneration,
      topLevelOrigin: session.topLevelOrigin,
      requester: structuredClone(session.requester)
    }
    const wallets = access.accessibleWallets(context, 'evm')
    const currentNetworkWallets = wallets.filter((wallet) => wallet.network.id === session.networkId)
    if (currentNetworkWallets.length) {
      const accounts = permittedAccounts(access, context, currentNetworkWallets)
      if (!isDeepStrictEqual(session.accounts, accounts)) {
        session.accounts = [...accounts]
        access.evmProviderSessions.set(key, session)
        access.options.onProviderEvent?.(session.tabId, {
          family: 'evm', event: 'accountsChanged', payload: accounts
        })
      }
      continue
    }
    if (!wallets.length) {
      access.evmProviderSessions.delete(key)
      if (session.accounts.length) {
        access.options.onProviderEvent?.(session.tabId, {
          family: 'evm', event: 'accountsChanged', payload: []
        })
      }
      access.options.onProviderEvent?.(session.tabId, {
        family: 'evm', event: 'disconnect', payload: {
          code: 1000,
          message: 'EVM provider disconnected'
        }
      })
      continue
    }
    const fallback = access.selectWallet(wallets)
    session.networkId = fallback.network.id
    session.accounts = permittedAccounts(
      access,
      context,
      wallets.filter((wallet) => wallet.network.id === fallback.network.id)
    )
    access.evmProviderSessions.set(key, session)
    access.options.onProviderEvent?.(session.tabId, {
      family: 'evm', event: 'chainChanged', payload: `0x${BigInt(fallback.network.id).toString(16)}`
    })
    access.options.onProviderEvent?.(session.tabId, {
      family: 'evm', event: 'accountsChanged',
      payload: [...session.accounts]
    })
  }
}

function permittedAccounts(access: EvmProviderAccess, context: WalletBrokerContext, wallets: WalletDescriptor[]): string[] {
  return wallets.filter((wallet) => access.hasAddressPermission(context, wallet)).map((wallet) => wallet.publicAddress)
}
