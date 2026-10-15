import {
  MAX_WALLET_DECIMAL_LENGTH,
  walletAllowsWorkspace,
  type WalletDescriptor,
  type WalletOperationRequest,
  type WalletPolicy
} from '../../shared/wallet.js'

export interface WalletDecodedOperation {
  understood: boolean
  source?: string
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

const AUTOMATION_ALLOWED_EVM_TESTNET_IDS: ReadonlySet<string> = new Set([
  '97', // BNB Smart Chain testnet
  '17000', // Holesky
  '43113', // Avalanche Fuji
  '80002', // Polygon Amoy
  '84532', // Base Sepolia
  '421614', // Arbitrum Sepolia
  '11155111', // Ethereum Sepolia
  '11155420', // Optimism Sepolia
  '560048' // Hoodi
])

const AUTOMATION_LOCAL_EVM_IDS: ReadonlySet<string> = new Set(['1337', '31337'])

export const MAINNET_AGENT_AUTOMATION_MAX_OPERATIONS = 100
export const MAINNET_AGENT_AUTOMATION_MAX_DURATION_MS = 7 * 24 * 60 * 60_000

export function isMainnetAgentAutomationPolicy(policy: WalletPolicy, now: Date): boolean {
  const expiresIn = Date.parse(policy.expiresAt) - now.getTime()
  return policy.allowMainnetAgentAutomation === true
    && policy.mode === 'bounded-auto'
    && policy.networkIds.length === 1
    && policy.origins.length === 1
    && policy.destinations.length === 1
    && policy.methods.length === 1
    && policy.maxNativeAmount !== undefined
    && policy.maxTokenAmount !== undefined
    && policy.maxFee !== undefined
    && policy.sessionSpendLimit !== undefined
    && policy.dailySpendLimit !== undefined
    && policy.maximumOperationCount <= MAINNET_AGENT_AUTOMATION_MAX_OPERATIONS
    && policy.requireSuccessfulSimulation
    && !policy.allowMessageSigning
    && expiresIn > 0
    && expiresIn <= MAINNET_AGENT_AUTOMATION_MAX_DURATION_MS
}

export function isMainnetWebsiteSignInPolicy(policy: WalletPolicy, now: Date): boolean {
  const expiresIn = Date.parse(policy.expiresAt) - now.getTime()
  return policy.allowWebsiteSignIn === true
    && policy.allowMainnetWebsiteSignIn === true
    && policy.mode === 'bounded-auto'
    && policy.networkIds.length === 1
    && policy.origins.length === 1
    && policy.maximumOperationCount <= MAINNET_AGENT_AUTOMATION_MAX_OPERATIONS
    && expiresIn > 0
    && expiresIn <= MAINNET_AGENT_AUTOMATION_MAX_DURATION_MS
}

function isLoopbackRpc(rpcUrl: string): boolean {
  return isLoopbackHostname(new URL(rpcUrl).hostname)
}

function isLoopbackHostname(value: string): boolean {
  const hostname = value.toLowerCase()
  return hostname === 'localhost'
    || hostname === '::1'
    || hostname === '[::1]'
    || /^127(?:\.\d{1,3}){3}$/.test(hostname)
}

export function isWalletNetworkEligibleForAutomation(wallet: WalletDescriptor): boolean {
  const networkId = wallet.network.id.toLowerCase()
  if (wallet.network.environment === 'testnet') {
    // The EVM adapter requires eth_chainId to match this configured allowlisted ID
    // before policy evaluation. That does not independently prove endpoint honesty.
    // Solana and TRON must remain human-approved until their adapters bind a
    // trusted genesis/network fingerprint into the normalized request.
    return wallet.chainFamily === 'evm' && AUTOMATION_ALLOWED_EVM_TESTNET_IDS.has(networkId)
  }
  if (wallet.network.environment === 'local') {
    // Solana and TRON RPC endpoints do not yet attest an independently trusted
    // network identity, including when the endpoint itself is loopback-only.
    return wallet.chainFamily === 'evm'
      && AUTOMATION_LOCAL_EVM_IDS.has(networkId)
      && isLoopbackRpc(wallet.network.rpcUrl)
  }
  return false
}

/**
 * Whether a bounded policy lets websites connect and sign plain-text sign-in
 * messages on this wallet without a click. Testnets and loopback local chains
 * qualify on their own; mainnet also needs the separate mainnet switch, a
 * dedicated EVM agent wallet and the tighter mainnet limits.
 */
export function websiteSignInPolicyApplies(wallet: WalletDescriptor, policy: WalletPolicy, now: Date): boolean {
  if (policy.mode !== 'bounded-auto' || policy.allowWebsiteSignIn !== true || policy.walletId !== wallet.id) return false
  if (wallet.chainFamily !== 'evm' || wallet.kind === 'watch-only' || !wallet.capabilities.includes('sign')) return false
  if (Date.parse(policy.expiresAt) <= now.getTime() || !policy.networkIds.includes(wallet.network.id)) return false
  if (wallet.network.environment === 'mainnet') return wallet.kind === 'agent' && isMainnetWebsiteSignInPolicy(policy, now)
  return policy.allowMainnetWebsiteSignIn !== true && isWalletNetworkEligibleForAutomation(wallet)
}

export const WEBSITE_SIGN_IN_MAX_MESSAGE_BYTES = 4096

// Control characters other than tab and line feed, plus format (including
// bidirectional and zero-width), private-use and line or paragraph separator
// characters. Carriage returns are excluded so a sign-in header cannot hide
// behind CRLF line endings.
const NON_PLAIN_TEXT = /[^\P{Cc}\t\n]|[\p{Cf}\p{Co}\p{Zl}\p{Zp}]/u
// For display only: also default-ignorable characters (such as variation
// selectors and Hangul fillers), noncharacters and the blank braille pattern,
// which render as nothing or as blank space.
const HIDDEN_DISPLAY_CHARACTER = /[^\P{Cc}\t\n]|[\p{Cf}\p{Co}\p{Zl}\p{Zp}\p{Default_Ignorable_Code_Point}\p{Noncharacter_Code_Point}\u2800]/u
const SIGN_IN_PHRASE = /wants you to sign in with your/i
const EIP_4361_HEADER = /^(?:([a-zA-Z][a-zA-Z0-9+.-]*):\/\/)?([^\s/?#]+) wants you to sign in with your Ethereum account:$/
const SOLANA_SIGN_IN_HEADER = /^(?:([a-zA-Z][a-zA-Z0-9+.-]*):\/\/)?([^\s/?#]+) wants you to sign in with your Solana account:$/
const EVM_ADDRESS_LINE = /^0x[0-9a-fA-F]{40}$/
const CHAIN_ID_LINE = /^Chain ID: ([1-9]\d{0,19})$/

/**
 * Returns why a website message cannot be signed without a click, or
 * undefined when it is bounded UTF-8 plain text. Text that looks like an
 * EIP-4361 sign-in message must name the requesting site, the wallet address
 * and the wallet's chain, so one allowed site cannot obtain a sign-in for
 * another site or chain. A personal_sign signature is valid on every chain,
 * so other plain text is signed only by a dedicated agent wallet; a managed
 * or imported key may also be the person's key elsewhere.
 */
export function websiteSignInMessageIssue(message: Uint8Array, wallet: WalletDescriptor, topLevelOrigin: string): string | undefined {
  if (!message.length || message.length > WEBSITE_SIGN_IN_MAX_MESSAGE_BYTES) return 'message-not-plain-text'
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(message)
  } catch {
    return 'message-not-plain-text'
  }
  if (NON_PLAIN_TEXT.test(text)) return 'message-not-plain-text'
  if (!isSignInText(text)) return wallet.kind === 'agent' ? undefined : 'plain-text-requires-agent-wallet'
  return signInTextIssue(text, wallet, topLevelOrigin)
}

export type WalletSignInTextIssue =
  | 'sign-in-message-unverified'
  | 'sign-in-domain-mismatch'
  | 'sign-in-address-mismatch'
  | 'sign-in-chain-mismatch'

/** Whether text uses the Sign-In with Ethereum or Solana phrase. */
export function isSignInText(text: string): boolean {
  return SIGN_IN_PHRASE.test(text)
}

/**
 * Whether text holds a character that renders as nothing, as blank space or
 * reorders text: controls other than tab and line feed, format (bidirectional
 * and zero-width), default-ignorable, private-use, line or paragraph
 * separator, noncharacter or blank braille characters. Display only; the
 * automatic sign-in check keeps its own narrower rule.
 */
export function hasHiddenMessageCharacters(text: string): boolean {
  return HIDDEN_DISPLAY_CHARACTER.test(text)
}

/**
 * The first maxLength characters of text, with each hidden character shown as
 * a visible [U+XXXX] marker. It never splits a character or a marker.
 */
export function revealHiddenMessageCharacters(text: string, maxLength: number): { text: string; truncated: boolean } {
  let visible = ''
  for (const character of text) {
    const piece = HIDDEN_DISPLAY_CHARACTER.test(character)
      ? `[U+${(character.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, '0')}]`
      : character
    if (visible.length + piece.length > maxLength) return { text: visible, truncated: true }
    visible += piece
  }
  return { text: visible, truncated: false }
}

/**
 * For the approval dialog: why sign-in text does not name the requesting
 * site and this wallet (and, on EVM, its chain). Sign-In with Solana has no
 * required chain line, and TRON has no sign-in standard to check.
 */
export function signInTextWarningIssue(text: string, wallet: WalletDescriptor, topLevelOrigin: string): WalletSignInTextIssue | undefined {
  if (wallet.chainFamily === 'evm') return signInTextIssue(text, wallet, topLevelOrigin)
  if (wallet.chainFamily !== 'solana') return 'sign-in-message-unverified'
  const lines = text.split('\n')
  const header = SOLANA_SIGN_IN_HEADER.exec(lines[0] ?? '')
  if (!header || !lines[1]) return 'sign-in-message-unverified'
  let origin: URL
  try {
    origin = new URL(topLevelOrigin)
  } catch {
    return 'sign-in-domain-mismatch'
  }
  const [, scheme, domain] = header
  if (scheme !== undefined && `${scheme.toLowerCase()}:` !== origin.protocol) return 'sign-in-domain-mismatch'
  if (domain?.toLowerCase() !== origin.host.toLowerCase()) return 'sign-in-domain-mismatch'
  if (lines[1] !== wallet.publicAddress) return 'sign-in-address-mismatch'
  return undefined
}

/**
 * Why EIP-4361 text does not name the requesting site, the wallet address and
 * its chain, or undefined when it names all three.
 */
export function signInTextIssue(text: string, wallet: WalletDescriptor, topLevelOrigin: string): WalletSignInTextIssue | undefined {
  const lines = text.split('\n')
  const header = EIP_4361_HEADER.exec(lines[0] ?? '')
  const addressLine = lines[1] ?? ''
  if (!header || !EVM_ADDRESS_LINE.test(addressLine)) return 'sign-in-message-unverified'
  let origin: URL
  try {
    origin = new URL(topLevelOrigin)
  } catch {
    return 'sign-in-domain-mismatch'
  }
  const [, scheme, domain] = header
  if (scheme !== undefined && `${scheme.toLowerCase()}:` !== origin.protocol) return 'sign-in-domain-mismatch'
  // EIP-4361 verifiers read a missing scheme as https, so a plain-HTTP site
  // other than a loopback development server must name its scheme.
  if (scheme === undefined && origin.protocol === 'http:' && !isLoopbackHostname(origin.hostname)) return 'sign-in-domain-mismatch'
  if (domain?.toLowerCase() !== origin.host.toLowerCase()) return 'sign-in-domain-mismatch'
  if (addressLine.toLowerCase() !== wallet.publicAddress.toLowerCase()) return 'sign-in-address-mismatch'
  const chainLines = lines.filter((line) => line.startsWith('Chain ID:'))
  const chainId = chainLines.length === 1 ? CHAIN_ID_LINE.exec(chainLines[0] ?? '')?.[1] : undefined
  if (!chainId) return 'sign-in-message-unverified'
  if (chainId !== wallet.network.id) return 'sign-in-chain-mismatch'
  return undefined
}

export interface WalletWebsiteSignInEvaluation {
  request: WalletOperationRequest
  wallet: WalletDescriptor
  policies: readonly WalletPolicy[]
  now: Date
  usageByPolicy: Readonly<Record<string, { operationCount: number }>>
  message?: { kind: 'message'; bytes: Uint8Array; raw: boolean } | { kind: 'typed-data' }
}

function decimal(value: string | undefined): DecimalValue {
  const source = value ?? '0'
  if (source.length > MAX_WALLET_DECIMAL_LENGTH) throw new TypeError('Invalid wallet amount')
  const match = /^(\d+)(?:\.(\d+))?$/.exec(source)
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
  if (!scale) {
    const result = digits.toString()
    if (result.length > MAX_WALLET_DECIMAL_LENGTH) throw new TypeError('Invalid wallet amount')
    return result
  }
  const padded = digits.toString().padStart(scale + 1, '0')
  const result = `${padded.slice(0, -scale)}.${padded.slice(-scale)}`
  if (result.length > MAX_WALLET_DECIMAL_LENGTH) throw new TypeError('Invalid wallet amount')
  return result
}

function includesNormalized(values: readonly string[], target: string | undefined): boolean {
  return Boolean(target && values.some((value) => value.toLowerCase() === target.toLowerCase()))
}

export function walletPolicyDestinationMatches(
  chainFamily: WalletDescriptor['chainFamily'],
  values: readonly string[],
  target: string | undefined
): boolean {
  if (!target) return false
  return chainFamily === 'evm'
    ? includesNormalized(values, target)
    : values.includes(target)
}

export class WalletPolicyEngine {
  evaluate(input: WalletPolicyEvaluation): WalletPolicyDecision {
    const { request, wallet, decoded, simulation } = input
    if (!wallet.capabilities.includes(request.capability)) return { outcome: 'rejected', reason: 'wallet-capability-disabled' }
    if (!walletAllowsWorkspace(wallet, request.workspaceId)) return { outcome: 'rejected', reason: 'wallet-not-attached-to-workspace' }
    if (wallet.chainFamily !== request.chainFamily || wallet.network.id !== request.networkId) {
      return { outcome: 'rejected', reason: 'chain-or-network-mismatch' }
    }
    if (wallet.kind === 'watch-only' && request.capability !== 'read') return { outcome: 'rejected', reason: 'watch-only-wallet' }
    const mainnetAgentBypassCandidate = wallet.network.environment === 'mainnet'
      && wallet.chainFamily === 'evm'
      && wallet.kind === 'agent'
      && request.requester.type === 'agent'
      && request.operation !== 'sign-message'
    if (wallet.network.environment === 'mainnet' && request.capability !== 'read' && !mainnetAgentBypassCandidate) {
      return { outcome: 'awaiting-human', reason: 'mainnet-requires-human' }
    }
    if (!decoded.understood) return { outcome: 'awaiting-human', reason: 'unknown-transaction' }
    if (decoded.unlimitedAllowance) return { outcome: 'awaiting-human', reason: 'unlimited-allowance' }
    if (decoded.newContractOrProgram) return { outcome: 'awaiting-human', reason: 'new-contract-or-program' }
    if (decoded.blindMessage) return { outcome: 'awaiting-human', reason: 'blind-message' }
    if (!simulation.attempted || !simulation.success) return { outcome: 'awaiting-human', reason: 'simulation-required' }
    if (wallet.network.environment !== 'mainnet' && !isWalletNetworkEligibleForAutomation(wallet)) {
      return { outcome: 'awaiting-human', reason: 'network-not-eligible-for-automation' }
    }

    for (const policy of input.policies) {
      const usage = input.usageByPolicy?.[policy.id] ?? input
      if (policy.mode !== 'bounded-auto' || policy.walletId !== wallet.id || policy.workspaceId !== request.workspaceId) continue
      if (wallet.network.environment === 'mainnet' && !isMainnetAgentAutomationPolicy(policy, input.now)) continue
      if (Date.parse(policy.expiresAt) <= input.now.getTime() || usage.operationCount >= policy.maximumOperationCount) continue
      if (!policy.networkIds.includes(request.networkId) || !policy.origins.includes(request.topLevelOrigin)) continue
      if (!walletPolicyDestinationMatches(wallet.chainFamily, policy.destinations, decoded.destination)
        || !includesNormalized(policy.methods, decoded.method)) continue
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

  /**
   * Decides whether a website's account connection or plain-text message
   * signature can proceed under an opted-in sign-in policy. It never rejects:
   * anything it does not approve goes to the person as before.
   */
  evaluateWebsiteSignIn(input: WalletWebsiteSignInEvaluation): WalletPolicyDecision {
    const { request, wallet } = input
    if (request.requester.type !== 'website') return { outcome: 'awaiting-human', reason: 'requester-not-website' }
    if (request.operation !== 'connect-account' && request.operation !== 'sign-message') {
      return { outcome: 'awaiting-human', reason: 'operation-requires-human' }
    }
    if (!wallet.capabilities.includes(request.capability) || !walletAllowsWorkspace(wallet, request.workspaceId)) {
      return { outcome: 'awaiting-human', reason: 'wallet-not-eligible' }
    }
    if (wallet.chainFamily !== request.chainFamily || wallet.network.id !== request.networkId) {
      return { outcome: 'awaiting-human', reason: 'chain-or-network-mismatch' }
    }
    if (request.operation === 'sign-message') {
      const message = input.message
      if (message?.kind !== 'message') return { outcome: 'awaiting-human', reason: 'typed-data-requires-human' }
      if (message.raw) return { outcome: 'awaiting-human', reason: 'raw-signing-requires-human' }
      const issue = websiteSignInMessageIssue(message.bytes, wallet, request.topLevelOrigin)
      if (issue) return { outcome: 'awaiting-human', reason: issue }
    }
    for (const policy of input.policies) {
      if (!websiteSignInPolicyApplies(wallet, policy, input.now) || policy.workspaceId !== request.workspaceId) continue
      if ((input.usageByPolicy[policy.id]?.operationCount ?? 0) >= policy.maximumOperationCount) continue
      if (!policy.networkIds.includes(request.networkId) || !policy.origins.includes(request.topLevelOrigin)) continue
      return { outcome: 'approved', reason: 'bounded-policy', policyId: policy.id }
    }
    return { outcome: 'awaiting-human', reason: 'no-matching-policy' }
  }
}
