import { address, getAddressEncoder, getBase58Encoder } from '@solana/kit'
import type { WalletChainFamily, WalletDescriptor, WalletRequester } from '../../shared/wallet.js'
import { normalizeTronProviderChainId, tronProviderChainId } from '../../shared/tron-chain-id.js'
import { solanaSignInMessage } from './solana-sign-in.js'
import type { WalletMessageSigningInput } from './accounts.js'
import type { WalletChainAdapter, WalletNormalizedTransaction } from './adapters/types.js'
import type { WalletBrokerContext, WalletBrokerOptions } from './broker.js'

/** A page's connection to one Solana or Tron account, which the broker drops when the page or its account permission goes away. */
export interface AccountProviderSession {
  family: Exclude<WalletChainFamily, 'evm'>
  walletId: string
  workspaceId: string
  tabId: string
  navigationGeneration: number
  topLevelOrigin: string
  requester: WalletRequester
  account: string
}

/**
 * What the Solana and Tron page providers need from the broker, which keeps
 * the page connections, permissions and request path, so connecting,
 * signing and sending still go through its account permission checks and
 * approvals.
 */
export interface SolanaTronProviderAccess {
  adapters: Record<WalletChainFamily, WalletChainAdapter>
  options: Pick<WalletBrokerOptions, 'onProviderEvent'>
  accountProviderSessions: Map<string, AccountProviderSession>
  accessibleWallets(context: WalletBrokerContext, family: WalletChainFamily): WalletDescriptor[]
  selectWallet(wallets: WalletDescriptor[]): WalletDescriptor
  hasAddressPermission(context: WalletBrokerContext, wallet: WalletDescriptor): boolean
  assertAddressPermission(context: WalletBrokerContext, wallet: WalletDescriptor, capability: 'sign' | 'send'): void
  assertRequestContextActive(context: WalletBrokerContext): void
  scheduleProviderPermissionExpiry(): void
  connect(context: WalletBrokerContext, wallet: WalletDescriptor): Promise<unknown>
  disconnectWallet(context: WalletBrokerContext, wallet: WalletDescriptor): Promise<void>
  transactionRequest(
    context: WalletBrokerContext,
    wallet: WalletDescriptor,
    payload: unknown,
    broadcast: boolean,
    returnSummary?: boolean,
    prepared?: WalletNormalizedTransaction
  ): Promise<unknown>
  messageRequest(context: WalletBrokerContext, wallet: WalletDescriptor, input: WalletMessageSigningInput): Promise<unknown>
  messageBytes(value: unknown): Uint8Array
}

function paramsArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : value === undefined ? [] : [value]
}

function isSilentSolanaConnect(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const options = value as { silent?: unknown; onlyIfTrusted?: unknown }
  return options.silent === true || options.onlyIfTrusted === true
}

/** Answers a page's Solana wallet call, in the Wallet Standard form or its `legacy_` form, with one connected account per page. */
export async function solanaRequest(access: SolanaTronProviderAccess, context: WalletBrokerContext, wallets: WalletDescriptor[], method: string, params: unknown): Promise<unknown> {
  const legacy = method.startsWith('legacy_')
  const walletMethod = legacy ? method.slice('legacy_'.length) : method
  const connectedWallet = activeAccountProviderWallet(access, context, 'solana', wallets)
  if (walletMethod === 'disconnect') {
    const wallet = connectedWallet ?? preferredPermittedWallet(access, context, wallets)
    if (wallet) await access.disconnectWallet(context, wallet)
    return undefined
  }
  const permittedWallet = walletMethod === 'connect'
    ? preferredPermittedWallet(access, context, wallets)
    : undefined
  if (walletMethod === 'connect' && isSilentSolanaConnect(params) && !permittedWallet) return { accounts: [] }
  const wallet = connectedWallet ?? permittedWallet ?? access.selectWallet(wallets)
  if (walletMethod === 'connect') {
    const accounts = await access.connect(context, wallet)
    trackAccountProviderSession(access, context, wallet)
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
  access.assertAddressPermission(context, wallet, walletMethod === 'signAndSendTransaction' ? 'send' : 'sign')
  if (walletMethod === 'signIn') {
    const message = new TextEncoder().encode(solanaSignInMessage(paramsArray(params)[0], context.topLevelOrigin, wallet.publicAddress))
    const signature = await access.messageRequest(context, wallet, { kind: 'message', message })
    return {
      account: wallet.publicAddress,
      signedMessage: message,
      signature: base64ResultBytes(signature, 'Solana sign-in signature'),
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
    if (!legacy) inputs.forEach((input) => assertSolanaTransactionInput(wallet, input, broadcast))
    const normalized: WalletNormalizedTransaction[] = []
    for (const input of inputs) {
      normalized.push(await access.adapters.solana.normalizeTransaction(wallet, input))
      access.assertRequestContextActive(context)
    }
    const results: unknown[] = []
    for (const [index, input] of inputs.entries()) {
      const result = await access.transactionRequest(context, wallet, input, broadcast, false, normalized[index])
      if (broadcast) {
        const signature = getBase58Encoder().encode(String(result))
        results.push(legacy ? String(result) : { signature })
      } else {
        const signedTransaction = base64ResultBytes(result, 'Solana signed transaction')
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
      return access.messageBytes(input?.message)
    })
    const results: unknown[] = []
    for (const message of messages) {
      const signature = await access.messageRequest(context, wallet, { kind: 'message', message })
      const signatureBytes = base64ResultBytes(signature, 'Solana message signature')
      results.push(legacy
        ? { signature: signatureBytes, publicKey: wallet.publicAddress }
        : { signedMessage: Uint8Array.from(message), signature: signatureBytes })
    }
    return legacy ? results[0] : results
  }
  throw new Error(`Unsupported Solana wallet method: ${walletMethod}`)
}

function assertSolanaTransactionInput(
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

/** Answers a page's Tron wallet call, in the TronLink-style form that reuses eth_ method names, with one connected account per page. */
export async function tronRequest(access: SolanaTronProviderAccess, context: WalletBrokerContext, wallets: WalletDescriptor[], method: string, params: unknown): Promise<unknown> {
  const connectedWallet = activeAccountProviderWallet(access, context, 'tron', wallets)
  const permittedWallet = preferredPermittedWallet(access, context, wallets)
  if (method === 'eth_accounts') {
    const wallet = connectedWallet ?? permittedWallet
    if (wallet && trackAccountProviderSession(access, context, wallet)) {
      publishTronConnection(access, context, wallet)
    }
    return wallet ? [wallet.publicAddress] : []
  }
  const wallet = connectedWallet ?? permittedWallet ?? access.selectWallet(wallets)
  if (method === 'eth_chainId') {
    const chainId = tronProviderChainId(wallet.network.id)
    if (!chainId) throw new Error('Tron provider chain ID is unavailable for the configured network')
    return chainId
  }
  if (method === 'eth_requestAccounts') {
    const accounts = await access.connect(context, wallet)
    if (trackAccountProviderSession(access, context, wallet)) publishTronConnection(access, context, wallet)
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
  access.assertAddressPermission(context, wallet, method === 'tron_signAndSendTransaction' ? 'send' : 'sign')
  if (method === 'tron_signTransaction' || method === 'tron_signAndSendTransaction') {
    const broadcast = method === 'tron_signAndSendTransaction'
    const result = await access.transactionRequest(context, wallet, paramsArray(params)[0], broadcast)
    if (broadcast) return result
    return tronSignedTransaction(result)
  }
  if (method === 'tron_signMessage') {
    const values = paramsArray(params)
    const requestedAddress = values.length > 1 ? values[0] : wallet.publicAddress
    const message = values.length > 1 ? values[1] : values[0]
    if (requestedAddress !== wallet.publicAddress) throw new Error('Tron message signer does not match the selected wallet')
    return access.messageRequest(context, wallet, { kind: 'message', message: access.messageBytes(message) })
  }
  throw new Error(`Unsupported Tron wallet method: ${method}`)
}

function accountProviderSessionKey(context: WalletBrokerContext, family: Exclude<WalletChainFamily, 'evm'>): string {
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

function activeAccountProviderWallet(
  access: SolanaTronProviderAccess,
  context: WalletBrokerContext,
  family: Exclude<WalletChainFamily, 'evm'>,
  wallets: WalletDescriptor[]
): WalletDescriptor | undefined {
  const session = access.accountProviderSessions.get(accountProviderSessionKey(context, family))
  return session
    ? wallets.find((wallet) => (
        wallet.id === session.walletId
        && wallet.publicAddress === session.account
        && access.hasAddressPermission(context, wallet)
      ))
    : undefined
}

function preferredPermittedWallet(
  access: SolanaTronProviderAccess,
  context: WalletBrokerContext,
  wallets: WalletDescriptor[]
): WalletDescriptor | undefined {
  return wallets.find((wallet) => wallet.kind !== 'watch-only' && access.hasAddressPermission(context, wallet))
    ?? wallets.find((wallet) => access.hasAddressPermission(context, wallet))
}

function trackAccountProviderSession(access: SolanaTronProviderAccess, context: WalletBrokerContext, wallet: WalletDescriptor): boolean {
  if (wallet.chainFamily === 'evm') return false
  const key = accountProviderSessionKey(context, wallet.chainFamily)
  const existing = access.accountProviderSessions.get(key)
  access.accountProviderSessions.set(key, {
    family: wallet.chainFamily,
    walletId: wallet.id,
    workspaceId: context.workspaceId,
    tabId: context.tabId,
    navigationGeneration: context.navigationGeneration,
    topLevelOrigin: context.topLevelOrigin,
    requester: structuredClone(context.requester),
    account: wallet.publicAddress
  })
  access.scheduleProviderPermissionExpiry()
  return !existing || existing.walletId !== wallet.id || existing.account !== wallet.publicAddress
}

function publishTronConnection(access: SolanaTronProviderAccess, context: WalletBrokerContext, wallet: WalletDescriptor): void {
  access.options.onProviderEvent?.(context.tabId, {
    family: 'tron', event: 'accountsChanged', payload: [wallet.publicAddress]
  })
  const chainId = tronProviderChainId(wallet.network.id)
  if (chainId) {
    access.options.onProviderEvent?.(context.tabId, {
      family: 'tron', event: 'connect', payload: { chainId }
    })
  }
}

/** Ends each Solana or Tron page connection whose wallet, account or account permission is gone, and tells the page. */
export function reconcileAccountProviderSessions(access: SolanaTronProviderAccess): void {
  for (const [key, session] of access.accountProviderSessions) {
    const context: WalletBrokerContext = {
      workspaceId: session.workspaceId,
      tabId: session.tabId,
      navigationGeneration: session.navigationGeneration,
      topLevelOrigin: session.topLevelOrigin,
      requester: structuredClone(session.requester)
    }
    const wallet = access.accessibleWallets(context, session.family).find((entry) => entry.id === session.walletId)
    if (wallet?.publicAddress === session.account && access.hasAddressPermission(context, wallet)) continue
    access.accountProviderSessions.delete(key)
    access.options.onProviderEvent?.(session.tabId, {
      family: session.family,
      event: 'accountsChanged',
      payload: []
    })
    access.options.onProviderEvent?.(session.tabId, {
      family: session.family,
      event: 'disconnect',
      ...(session.family === 'tron' ? {
        payload: { code: 4900, message: 'Tron provider disconnected' }
      } : {})
    })
  }
}

function base64ResultBytes(value: unknown, label: string): Uint8Array {
  if (typeof value !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) throw new Error(`${label} is invalid`)
  const bytes = Buffer.from(value, 'base64')
  if (!bytes.length || bytes.toString('base64') !== value) throw new Error(`${label} is invalid`)
  return Uint8Array.from(bytes)
}

function tronSignedTransaction(value: unknown): Record<string, unknown> {
  const bytes = base64ResultBytes(value, 'Signed Tron transaction')
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
