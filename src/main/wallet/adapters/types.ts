import type { WalletDecodedOperation, WalletSimulationResult } from '../policy.js'
import type { WalletDescriptor } from '../../../shared/wallet.js'
import type { WalletSecret } from '../vault.js'

export interface WalletNormalizedTransaction {
  chainFamily: WalletDescriptor['chainFamily']
  networkId: string
  signer: string
  nonceOrBlockhash?: string
  raw: Record<string, unknown>
  decoded: WalletDecodedOperation
}

export interface WalletTransactionSimulation extends WalletSimulationResult {
  estimatedFee?: string
  logs?: string[]
}

export interface WalletConfirmation {
  confirmed: boolean
  failed: boolean
  blockReference?: string
}

export interface WalletTokenBalance {
  token: string
  balance: string
  rawBalance: string
  decimals: number
  symbol?: string
}

/** Formats an integer token amount with the token's decimals, trimming trailing zeros. */
export function formatTokenUnits(amount: bigint, decimals: number): string {
  if (decimals === 0) return amount.toString()
  const scale = 10n ** BigInt(decimals)
  const whole = amount / scale
  const fraction = (amount % scale).toString().padStart(decimals, '0').replace(/0+$/, '')
  return fraction ? `${whole}.${fraction}` : whole.toString()
}

export interface WalletChainAdapter {
  readonly family: WalletDescriptor['chainFamily']
  validateAddress(address: string): boolean
  normalizeTransaction(wallet: WalletDescriptor, payload: unknown): Promise<WalletNormalizedTransaction>
  simulate(wallet: WalletDescriptor, transaction: WalletNormalizedTransaction): Promise<WalletTransactionSimulation>
  sign(wallet: WalletDescriptor, secret: WalletSecret, transaction: WalletNormalizedTransaction): Promise<string>
  broadcast(wallet: WalletDescriptor, signedTransaction: string): Promise<string>
  confirmation(wallet: WalletDescriptor, transactionHash: string): Promise<WalletConfirmation>
  balance(wallet: WalletDescriptor): Promise<string>
  /** Reads the wallet's balance of one fungible token (ERC-20 contract or SPL mint). */
  tokenBalance?(wallet: WalletDescriptor, token: string): Promise<WalletTokenBalance>
  /** Reads an ERC-20 contract's own symbol and decimals; a value it does not report is left out. */
  tokenContractDetails?(wallet: WalletDescriptor, token: string): Promise<{ symbol?: string; decimals?: number }>
  /** Forwards an allowlisted read-only JSON-RPC method to the wallet network. */
  readRpc?(wallet: WalletDescriptor, method: string, params: unknown): Promise<unknown>
}
