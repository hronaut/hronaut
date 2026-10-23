import type { WalletDescriptor, WalletMessageWarning, WalletRequestSummary } from '../../shared/wallet.js'
import { WALLET_MESSAGE_DISPLAY_MAX_LENGTH } from '../../shared/wallet.js'
import type { WalletMessageSigningInput } from './accounts.js'
import type { WalletApprovalRecord } from './approvals.js'
import { simulationRevertFromStored, storedSimulationRevert } from './evm-revert.js'
import type { WalletNormalizedTransaction, WalletTransactionSimulation } from './adapters/types.js'
import { hasHiddenMessageCharacters, revealHiddenMessageCharacters } from './hidden-characters.js'
import { transactionWarnings } from './transaction-display.js'
import { restoreWalletJson, walletJsonInspectable } from './json-safe.js'
import { isSignInText, signInTextWarningIssue, walletPolicyDestinationMatches, type WalletSignInTextIssue } from './policy.js'

/** Text with each wallet address replaced by the label, the EVM ones in any letter case and with or without 0x. */
export function withoutWalletAddresses(text: string, addresses: string[], label: string): string {
  return addresses.reduce((result, address) => (
    /^0x[0-9a-fA-F]{40}$/.test(address)
      ? result.replace(new RegExp(`(?:0x)?${address.slice(2)}`, 'gi'), label)
      : result.split(address).join(label)
  ), text)
}

const SIMULATION_FAILED = 'Wallet transaction simulation failed'

/**
 * The simulation as approval records keep it: adapter error text, which can
 * name the RPC endpoint, becomes a fixed message, and a revert reason read
 * from the revert data is kept as its own field.
 */
export function sanitizedSimulation(simulation: WalletTransactionSimulation): WalletTransactionSimulation {
  const revert = !simulation.success && simulation.revert ? storedSimulationRevert(simulation.revert) : undefined
  return {
    attempted: simulation.attempted,
    success: simulation.success,
    ...(simulation.estimatedFee && /^\d+(?:\.\d+)?$/.test(simulation.estimatedFee)
      ? { estimatedFee: simulation.estimatedFee }
      : {}),
    ...(revert || simulation.error ? { error: SIMULATION_FAILED } : {}),
    ...(revert ? { revert } : {})
  }
}

/** A recorded simulation for an agent, with its revert reason read back. */
export function agentSimulation(simulation: WalletTransactionSimulation): Record<string, unknown> {
  const revert = simulation.success ? undefined : simulationRevertFromStored(simulation.revert)
  return {
    attempted: simulation.attempted,
    success: simulation.success,
    ...(simulation.estimatedFee ? { estimatedFee: simulation.estimatedFee } : {}),
    ...(simulation.error ? { error: SIMULATION_FAILED } : {}),
    ...(revert ? { revert } : {})
  }
}

/** A request as the trusted approval UI lists it, with the wallet's details when the wallet is known. */
export function summary(record: WalletApprovalRecord, wallet?: WalletDescriptor): WalletRequestSummary {
  const normalized = record.request.payload.normalized
    ? restoreWalletJson(record.request.payload.normalized) as WalletNormalizedTransaction
    : undefined
  const warnings = normalized ? transactionWarnings(normalized.decoded) : []
  const simulationRevert = record.simulation && !record.simulation.success ? simulationRevertFromStored(record.simulation.revert) : undefined
  return {
    id: record.id,
    walletId: record.request.walletId,
    workspaceId: record.request.workspaceId,
    status: record.status,
    approvalHash: record.approvalHash ?? record.requestHash,
    operation: record.request.operation,
    requester: structuredClone(record.request.requester),
    origin: record.request.topLevelOrigin,
    networkId: record.request.networkId,
    createdAt: record.createdAt,
    expiresAt: record.request.expiresAt,
    ...(record.transactionHash ? { transactionHash: record.transactionHash } : {}),
    ...(wallet ? {
      details: {
        walletName: wallet.name,
        publicAddress: wallet.publicAddress,
        chainFamily: wallet.chainFamily,
        networkName: wallet.network.name,
        capability: record.request.capability,
        understood: normalized?.decoded.understood ?? record.request.operation === 'connect-account',
        simulationAttempted: record.simulation?.attempted ?? false,
        simulationSuccess: record.simulation?.success ?? false,
        ...(simulationRevert ? { simulationRevert } : {}),
        ...(normalized?.decoded.contract ? { contract: normalized.decoded.contract } : {}),
        ...(normalized?.decoded.source ? { source: normalized.decoded.source } : {}),
        ...(normalized?.decoded.destination ? { destination: normalized.decoded.destination } : {}),
        ...(normalized?.decoded.method ? { method: normalized.decoded.method } : {}),
        ...(normalized?.decoded.nativeAmount ? { nativeAmount: normalized.decoded.nativeAmount } : {}),
        ...(normalized?.decoded.tokenAmount ? { tokenAmount: normalized.decoded.tokenAmount } : {}),
        ...((record.simulation?.estimatedFee ?? normalized?.decoded.estimatedFee) ? {
          estimatedFee: record.simulation?.estimatedFee ?? normalized?.decoded.estimatedFee
        } : {}),
        ...(warnings.length ? { transactionWarnings: warnings } : {}),
        raw: walletJsonInspectable(normalized?.raw ?? record.request.payload) as Record<string, unknown>
      }
    } : {})
  }
}

/** What an agent sees in place of a wallet address the site or agent has no account permission for. */
export const HIDDEN_WALLET_ADDRESS = 'this wallet (address hidden until account permission)'
/** Hex digits of an address that a shortened message can end with and still be hidden. */
const MIN_HIDDEN_ADDRESS_PREFIX = 4

/** A contract's revert message with an EVM wallet's address hidden, including its start where the message was cut. */
function hideAddressInRevertMessage(message: string, truncated: boolean, publicAddress: string): string {
  const hex = publicAddress.slice(2).toLowerCase()
  const hidden = withoutWalletAddresses(message, [publicAddress], HIDDEN_WALLET_ADDRESS)
  const tail = truncated ? /[0-9a-fA-F]+$/.exec(hidden) : null
  if (!tail) return hidden
  for (let start = tail.index; start <= hidden.length - MIN_HIDDEN_ADDRESS_PREFIX; start += 1) {
    if (!hex.startsWith(hidden.slice(start).toLowerCase())) continue
    return `${hidden.slice(0, hidden.slice(start - 2, start).toLowerCase() === '0x' ? start - 2 : start)}${HIDDEN_WALLET_ADDRESS}`
  }
  return hidden
}

/**
 * A request as an agent sees it: without the raw payload and, unless
 * includeAddress, with the wallet's address hidden wherever the request names it.
 */
export function agentSummary(
  record: WalletApprovalRecord,
  wallet?: WalletDescriptor,
  includeAddress = true
): Record<string, unknown> {
  const full = summary(record, wallet)
  if (!full.details) return full
  const { raw: _raw, publicAddress, ...details } = full.details
  if (!includeAddress) {
    // A request can name the wallet itself, such as a transfer to its own address.
    for (const field of ['contract', 'source', 'destination'] as const) {
      if (walletPolicyDestinationMatches(details.chainFamily, [publicAddress], details[field])) details[field] = HIDDEN_WALLET_ADDRESS
    }
    // A contract can put the calling account in its revert message.
    if (details.simulationRevert?.kind === 'message' && /^0x[0-9a-fA-F]{40}$/.test(publicAddress)) {
      const { message, truncated } = details.simulationRevert
      details.simulationRevert = { ...details.simulationRevert, message: hideAddressInRevertMessage(message, truncated === true, publicAddress) }
    }
  }
  return {
    ...full,
    details: {
      ...details,
      ...(includeAddress ? { publicAddress } : {})
    }
  }
}

/** The message or typed data awaiting approval, in full, for the raw request in the trusted approval dialog. */
export function trustedMessageRaw(input: WalletMessageSigningInput): Record<string, unknown> {
  if (input.kind === 'typed-data') return { typedData: structuredClone(input.typedData) }
  const bytes = Buffer.from(input.message)
  const message: Record<string, unknown> = {
    encoding: 'base64',
    value: bytes.toString('base64')
  }
  try {
    const decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    message.utf8Preview = decoded.slice(0, 4_096)
    if (decoded.length > 4_096) message.utf8PreviewTruncated = true
  } catch {
    // Binary messages remain fully inspectable through their canonical base64 value.
  } finally {
    bytes.fill(0)
  }
  return { message }
}

const SIGN_IN_TEXT_WARNINGS: Record<WalletSignInTextIssue, WalletMessageWarning> = {
  'sign-in-domain-mismatch': 'sign-in-other-site',
  'sign-in-address-mismatch': 'sign-in-other-account',
  'sign-in-chain-mismatch': 'sign-in-other-chain',
  'sign-in-message-unverified': 'sign-in-unverified'
}

/**
 * Readable text of a UTF-8 message for the trusted approval dialog. Hidden
 * characters are shown as [U+XXXX] markers, and sign-in text that names
 * another site, account or chain than this request is flagged. Binary
 * messages and typed data have no text; the raw request shows them.
 */
export function trustedMessageDisplay(
  input: WalletMessageSigningInput,
  wallet: WalletDescriptor,
  topLevelOrigin: string
): NonNullable<WalletRequestSummary['details']>['message'] {
  if (input.kind !== 'message') return undefined
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(input.message)
  } catch {
    return undefined
  }
  const warnings: WalletMessageWarning[] = []
  if (hasHiddenMessageCharacters(text)) warnings.push('hidden-characters')
  const signInIssue = isSignInText(text) ? signInTextWarningIssue(text, wallet, topLevelOrigin) : undefined
  if (signInIssue) warnings.push(SIGN_IN_TEXT_WARNINGS[signInIssue])
  const visible = revealHiddenMessageCharacters(text, WALLET_MESSAGE_DISPLAY_MAX_LENGTH)
  return { text: visible.text, ...(visible.truncated ? { truncated: true as const } : {}), warnings }
}
