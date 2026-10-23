import type { WalletTransactionWarning } from '../../shared/wallet.js'
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
