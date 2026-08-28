import type { WalletDescriptor, WalletOperationRequest, WalletPolicy } from '../../shared/wallet.js'

export interface WalletDecodedOperation {
  understood: boolean
  destination?: string
  method?: string
  nativeAmount?: string
  tokenAmount?: string
  estimatedFee?: string
  unlimitedAllowance: boolean
  newContractOrProgram: boolean
  blindMessage: boolean
}

export interface WalletSimulationResult {
  attempted: boolean
  success: boolean
  error?: string
}

export type WalletPolicyDecision =
  | { outcome: 'approved'; reason: 'bounded-policy'; policyId: string }
  | { outcome: 'awaiting-human'; reason: string }
  | { outcome: 'rejected'; reason: string }

export interface WalletPolicyEvaluation {
  request: WalletOperationRequest
  wallet: WalletDescriptor
  policies: readonly WalletPolicy[]
  decoded: WalletDecodedOperation
  simulation: WalletSimulationResult
  now: Date
  sessionSpend: string
  dailySpend: string
  operationCount: number
  usageByPolicy?: Readonly<Record<string, {
    sessionSpend: string
    dailySpend: string
    operationCount: number
  }>>
}

interface DecimalValue {
  digits: bigint
  scale: number
}

const AUTOMATION_TESTNET_IDS: Readonly<Record<WalletDescriptor['chainFamily'], ReadonlySet<string>>> = {
  evm: new Set([
    '97', // BNB Smart Chain testnet
    '17000', // Holesky
    '43113', // Avalanche Fuji
    '80002', // Polygon Amoy
    '84532', // Base Sepolia
    '421614', // Arbitrum Sepolia
    '11155111', // Ethereum Sepolia
    '11155420', // Optimism Sepolia
    '560048' // Hoodi
  ]),
  solana: new Set(['devnet', 'testnet']),
  tron: new Set(['nile', 'shasta'])
}

const AUTOMATION_LOCAL_IDS: Readonly<Record<WalletDescriptor['chainFamily'], ReadonlySet<string>>> = {
  evm: new Set(['1337', '31337']),
  solana: new Set(['local', 'localnet']),
  tron: new Set(['local', 'private', 'private-net'])
}

function isLoopbackRpc(rpcUrl: string): boolean {
  const hostname = new URL(rpcUrl).hostname.toLowerCase()
  return hostname === 'localhost'
    || hostname === '::1'
    || hostname === '[::1]'
    || /^127(?:\.\d{1,3}){3}$/.test(hostname)
}

export function isWalletNetworkEligibleForAutomation(wallet: WalletDescriptor): boolean {
  const networkId = wallet.network.id.toLowerCase()
  if (wallet.network.environment === 'testnet') {
    return AUTOMATION_TESTNET_IDS[wallet.chainFamily].has(networkId)
  }
  if (wallet.network.environment === 'local') {
    return AUTOMATION_LOCAL_IDS[wallet.chainFamily].has(networkId) && isLoopbackRpc(wallet.network.rpcUrl)
  }
  return false
}

function decimal(value: string | undefined): DecimalValue {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(value ?? '0')
  if (!match) throw new TypeError('Invalid wallet amount')
  const fraction = match[2] ?? ''
  return { digits: BigInt(`${match[1]}${fraction}`), scale: fraction.length }
}

export function walletDecimalCompare(leftValue: string | undefined, rightValue: string | undefined): number {
  const left = decimal(leftValue)
  const right = decimal(rightValue)
  const scale = Math.max(left.scale, right.scale)
  const leftDigits = left.digits * 10n ** BigInt(scale - left.scale)
  const rightDigits = right.digits * 10n ** BigInt(scale - right.scale)
  return leftDigits < rightDigits ? -1 : leftDigits > rightDigits ? 1 : 0
}

export function walletDecimalAdd(leftValue: string | undefined, rightValue: string | undefined): string {
  const left = decimal(leftValue)
  const right = decimal(rightValue)
  const scale = Math.max(left.scale, right.scale)
  const digits = left.digits * 10n ** BigInt(scale - left.scale) + right.digits * 10n ** BigInt(scale - right.scale)
  if (!scale) return digits.toString()
  const padded = digits.toString().padStart(scale + 1, '0')
  return `${padded.slice(0, -scale)}.${padded.slice(-scale)}`
}

function includesNormalized(values: readonly string[], target: string | undefined): boolean {
  return Boolean(target && values.some((value) => value.toLowerCase() === target.toLowerCase()))
}

export class WalletPolicyEngine {
  evaluate(input: WalletPolicyEvaluation): WalletPolicyDecision {
    const { request, wallet, decoded, simulation } = input
    if (!wallet.capabilities.includes(request.capability)) return { outcome: 'rejected', reason: 'wallet-capability-disabled' }
    if (!wallet.workspaceIds.includes(request.workspaceId)) return { outcome: 'rejected', reason: 'wallet-not-attached-to-workspace' }
    if (wallet.chainFamily !== request.chainFamily || wallet.network.id !== request.networkId) {
      return { outcome: 'rejected', reason: 'chain-or-network-mismatch' }
    }
    if (wallet.kind === 'watch-only' && request.capability !== 'read') return { outcome: 'rejected', reason: 'watch-only-wallet' }
    if (wallet.network.environment === 'mainnet' && request.capability !== 'read') {
      return { outcome: 'awaiting-human', reason: 'mainnet-requires-human' }
    }
    if (!decoded.understood) return { outcome: 'awaiting-human', reason: 'unknown-transaction' }
    if (decoded.unlimitedAllowance) return { outcome: 'awaiting-human', reason: 'unlimited-allowance' }
    if (decoded.newContractOrProgram) return { outcome: 'awaiting-human', reason: 'new-contract-or-program' }
    if (decoded.blindMessage) return { outcome: 'awaiting-human', reason: 'blind-message' }
    if (!simulation.attempted || !simulation.success) return { outcome: 'awaiting-human', reason: 'simulation-required' }
    if (!isWalletNetworkEligibleForAutomation(wallet)) {
      return { outcome: 'awaiting-human', reason: 'network-not-eligible-for-automation' }
    }

    for (const policy of input.policies) {
      const usage = input.usageByPolicy?.[policy.id] ?? input
      if (policy.mode !== 'bounded-auto' || policy.walletId !== wallet.id || policy.workspaceId !== request.workspaceId) continue
      if (Date.parse(policy.expiresAt) <= input.now.getTime() || usage.operationCount >= policy.maximumOperationCount) continue
      if (!policy.networkIds.includes(request.networkId) || !policy.origins.includes(request.topLevelOrigin)) continue
      if (!includesNormalized(policy.destinations, decoded.destination) || !includesNormalized(policy.methods, decoded.method)) continue
      if (request.operation === 'sign-message' && !policy.allowMessageSigning) continue
      if (policy.maxNativeAmount && walletDecimalCompare(decoded.nativeAmount, policy.maxNativeAmount) > 0) continue
      if (policy.maxTokenAmount && walletDecimalCompare(decoded.tokenAmount, policy.maxTokenAmount) > 0) continue
      if (policy.maxFee && walletDecimalCompare(decoded.estimatedFee, policy.maxFee) > 0) continue
      if (policy.sessionSpendLimit && walletDecimalCompare(walletDecimalAdd(usage.sessionSpend, decoded.nativeAmount), policy.sessionSpendLimit) > 0) continue
      if (policy.dailySpendLimit && walletDecimalCompare(walletDecimalAdd(usage.dailySpend, decoded.nativeAmount), policy.dailySpendLimit) > 0) continue
      return { outcome: 'approved', reason: 'bounded-policy', policyId: policy.id }
    }
    return { outcome: 'awaiting-human', reason: 'no-matching-policy' }
  }
}
