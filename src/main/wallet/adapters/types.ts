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

export interface WalletChainAdapter {
  readonly family: WalletDescriptor['chainFamily']
  validateAddress(address: string): boolean
  normalizeTransaction(wallet: WalletDescriptor, payload: unknown): Promise<WalletNormalizedTransaction>
  simulate(wallet: WalletDescriptor, transaction: WalletNormalizedTransaction): Promise<WalletTransactionSimulation>
  sign(wallet: WalletDescriptor, secret: WalletSecret, transaction: WalletNormalizedTransaction): Promise<string>
  broadcast(wallet: WalletDescriptor, signedTransaction: string): Promise<string>
  confirmation(wallet: WalletDescriptor, transactionHash: string): Promise<WalletConfirmation>
  balance(wallet: WalletDescriptor): Promise<string>
}
