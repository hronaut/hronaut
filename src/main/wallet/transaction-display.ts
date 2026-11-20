import * as viemChains from 'viem/chains'
import type { WalletDescriptor, WalletTransactionWarning } from '../../shared/wallet.js'
import type { WalletDecodedOperation } from './policy.js'

/**
 * Token amounts at or above this are treated as unlimited: Permit2 allowances
 * are uint160, and approvals commonly use the uint256 maximum or a value near it.
 */
const UNLIMITED_TOKEN_AMOUNT = 2n ** 160n - 1n
/**
 * Tokens that store allowances in fewer bits treat their type's maximum as
 * unlimited, such as UNI and COMP in 96 bits, so these exact amounts are too.
 */
const NARROW_UNLIMITED_TOKEN_AMOUNTS: ReadonlySet<bigint> = new Set([2n ** 96n - 1n, 2n ** 128n - 1n])

/** Whether a token amount or allowance is unlimited, as a token reads it. */
export function isUnlimitedTokenAmount(amount: bigint): boolean {
  return amount >= UNLIMITED_TOKEN_AMOUNT || NARROW_UNLIMITED_TOKEN_AMOUNTS.has(amount)
}

/** Formats an integer token amount with the token's decimals, trimming trailing zeros. */
export function formatTokenUnits(amount: bigint, decimals: number): string {
  if (decimals === 0) return amount.toString()
  const scale = 10n ** BigInt(decimals)
  const whole = amount / scale
  const fraction = (amount % scale).toString().padStart(decimals, '0').replace(/0+$/, '')
  return fraction ? `${whole}.${fraction}` : whole.toString()
}

/**
 * The most decimals Hronaut reads a token amount with. A uint256 has at most 78
 * digits, so more decimals could only add zeros after the point.
 */
export const MAX_TOKEN_DECIMALS = 77

/** A decoded token amount in whole tokens, or undefined when the token did not report usable decimals. */
export function wholeTokenAmount(decoded: Pick<WalletDecodedOperation, 'tokenAmount' | 'tokenDecimals'>): string | undefined {
  if (decoded.tokenDecimals === undefined || decoded.tokenAmount === undefined || !/^\d{1,78}$/.test(decoded.tokenAmount)) return undefined
  if (!Number.isInteger(decoded.tokenDecimals) || decoded.tokenDecimals < 0 || decoded.tokenDecimals > MAX_TOKEN_DECIMALS) return undefined
  return formatTokenUnits(BigInt(decoded.tokenAmount), decoded.tokenDecimals)
}

let evmNativeSymbols: ReadonlyMap<string, string> | undefined

/** Native currency symbols of the EVM chains viem knows, leaving out chain IDs that two chains share with different symbols. */
function knownEvmNativeSymbols(): ReadonlyMap<string, string> {
  if (evmNativeSymbols) return evmNativeSymbols
  const symbols = new Map<string, string | null>()
  for (const chain of Object.values(viemChains) as Array<{ id?: unknown; nativeCurrency?: { symbol?: unknown } }>) {
    if (typeof chain?.id !== 'number' || typeof chain.nativeCurrency?.symbol !== 'string') continue
    const id = String(chain.id)
    const known = symbols.get(id)
    symbols.set(id, known === undefined || known === chain.nativeCurrency.symbol ? chain.nativeCurrency.symbol : null)
  }
  evmNativeSymbols = new Map([...symbols].filter((entry): entry is [string, string] => entry[1] !== null))
  return evmNativeSymbols
}

/** The symbol of the wallet network's own currency, such as ETH, SOL or TRX, when Hronaut knows it. */
export function walletNativeSymbol(wallet: Pick<WalletDescriptor, 'chainFamily' | 'network'>): string | undefined {
  if (wallet.chainFamily === 'solana') return 'SOL'
  if (wallet.chainFamily === 'tron') return 'TRX'
  return knownEvmNativeSymbols().get(wallet.network.id)
}

const TOKEN_APPROVAL_METHODS: ReadonlySet<string> = new Set(['erc20.approve', 'trc20.approve'])
// An increase adds to whatever allowance the spender already has.
const ALLOWANCE_INCREASE_METHODS: ReadonlySet<string> = new Set(['erc20.increaseAllowance'])
const COLLECTION_APPROVAL_METHODS: ReadonlySet<string> = new Set(['nft.setApprovalForAll'])

/** Warnings the trusted approval dialog shows for a decoded transaction. */
export function transactionWarnings(decoded: WalletDecodedOperation): WalletTransactionWarning[] {
  const method = decoded.method ?? ''
  if (COLLECTION_APPROVAL_METHODS.has(method)) return decoded.unlimitedAllowance ? ['collection-approval'] : []
  const approval = TOKEN_APPROVAL_METHODS.has(method) ? 'token-approval' : ALLOWANCE_INCREASE_METHODS.has(method) ? 'allowance-increase' : undefined
  if (!approval) return []
  return decoded.unlimitedAllowance ? [approval, 'unlimited-allowance'] : [approval]
}
