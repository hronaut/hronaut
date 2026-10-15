import { decodeAbiParameters, toFunctionSelector, type Hex } from 'viem'
import { WALLET_REVERT_MESSAGE_MAX_LENGTH, WalletSimulationRevertSchema, type WalletSimulationRevert } from '../../shared/wallet.js'
import { revealHiddenMessageCharacters } from './hidden-characters.js'

/** Revert data longer than this is not decoded; the selector is still read. */
const MAX_REVERT_DATA_HEX_LENGTH = 16_386
/** Simulation errors that hold a revert reason start with this; the rest is its JSON. */
const STORED_REVERT_PREFIX = 'revert:'
const MAX_STORED_SIMULATION_ERROR_LENGTH = 512
const MAX_ERROR_CAUSE_DEPTH = 8

const ERROR_STRING_SELECTOR = '0x08c379a0'
const PANIC_SELECTOR = '0x4e487b71'

/** Solidity panic codes, as the compiler documents them. */
const PANIC_MEANINGS: Readonly<Record<string, string>> = {
  '0x0': 'generic compiler panic',
  '0x1': 'assertion failed',
  '0x11': 'arithmetic overflow or underflow',
  '0x12': 'division or modulo by zero',
  '0x21': 'invalid enum value',
  '0x22': 'invalid storage byte array encoding',
  '0x31': 'pop from an empty array',
  '0x32': 'array index out of bounds',
  '0x41': 'out of memory or array too large',
  '0x51': 'call to an uninitialized function'
}

/**
 * Custom errors common in tokens, access control and swap routers, so a
 * failed simulation names them instead of showing only the selector.
 */
const KNOWN_CUSTOM_ERRORS = [
  'ERC20InsufficientBalance(address,uint256,uint256)', 'ERC20InvalidSender(address)', 'ERC20InvalidReceiver(address)',
  'ERC20InsufficientAllowance(address,uint256,uint256)', 'ERC20InvalidApprover(address)', 'ERC20InvalidSpender(address)',
  'ERC721NonexistentToken(uint256)', 'ERC721IncorrectOwner(address,uint256,address)', 'ERC721InsufficientApproval(address,uint256)',
  'ERC721InvalidReceiver(address)', 'ERC1155InsufficientBalance(address,uint256,uint256,uint256)',
  'ERC1155MissingApprovalForAll(address,address)', 'ERC2612ExpiredSignature(uint256)', 'ERC2612InvalidSigner(address,address)',
  'InvalidAccountNonce(address,uint256)', 'OwnableUnauthorizedAccount(address)', 'AccessControlUnauthorizedAccount(address,bytes32)',
  'EnforcedPause()', 'ExpectedPause()', 'ReentrancyGuardReentrantCall()', 'SafeERC20FailedOperation(address)',
  'AddressEmptyCode(address)', 'FailedCall()', 'FailedInnerCall()', 'InsufficientBalance(uint256,uint256)',
  // Permit2
  'AllowanceExpired(uint256)', 'InsufficientAllowance(uint256)', 'SignatureExpired(uint256)', 'InvalidNonce()', 'InvalidSigner()',
  // Uniswap Universal Router
  'TransactionDeadlinePassed()', 'V2TooLittleReceived()', 'V2TooMuchRequested()', 'V3TooLittleReceived()', 'V3TooMuchRequested()',
  'V4TooLittleReceived(uint256,uint256)', 'V4TooMuchRequested(uint256,uint256)', 'ExecutionFailed(uint256,bytes)',
  // CCIP-Read (EIP-3668), which Hronaut does not follow
  'OffchainLookup(address,string[],bytes,bytes4,bytes)'
]
const CUSTOM_ERROR_NAMES = new Map<string, string>(KNOWN_CUSTOM_ERRORS.map((signature) => [
  toFunctionSelector(signature),
  signature.slice(0, signature.indexOf('('))
]))

/**
 * Why an EVM call reverted, read from the revert data a node returns with the
 * error, never from the node's error message, which can name the RPC endpoint.
 * Undefined when the call failed for another reason, such as insufficient
 * funds or a network error.
 */
export function evmRevertFromError(error: unknown): WalletSimulationRevert | undefined {
  let reverted = false
  let current: unknown = error
  for (let depth = 0; current !== null && typeof current === 'object' && depth < MAX_ERROR_CAUSE_DEPTH; depth += 1) {
    const data = revertData((current as { data?: unknown }).data)
    if (data !== undefined) return decodeRevertData(data)
    // viem marks a node's "execution reverted" without data this way; its other
    // trigger, "gas required exceeds allowance", is not a revert reason.
    const details = (current as { details?: unknown }).details
    if ((current as { name?: unknown }).name === 'ExecutionRevertedError' && typeof details === 'string' && /execution reverted/i.test(details)) {
      reverted = true
    }
    current = (current as { cause?: unknown }).cause
  }
  return reverted ? { kind: 'no-reason' } : undefined
}

function revertData(value: unknown): Hex | undefined {
  // Geth and most nodes send the data itself; some wrap it in { data }, and
  // OpenEthereum-style nodes prefix it with "Reverted ".
  const text = typeof value === 'string'
    ? value
    : value !== null && typeof value === 'object' && typeof (value as { data?: unknown }).data === 'string'
      ? (value as { data: string }).data
      : undefined
  const match = text === undefined ? null : /^(?:Reverted )?(0x(?:[0-9a-fA-F]{2})*)$/.exec(text)
  return match ? match[1]!.toLowerCase() as Hex : undefined
}

export function decodeRevertData(data: Hex): WalletSimulationRevert {
  if (data.length < 10) return { kind: 'no-reason' }
  const selector = data.slice(0, 10)
  if (data.length <= MAX_REVERT_DATA_HEX_LENGTH && selector === ERROR_STRING_SELECTOR) {
    try {
      const [message] = decodeAbiParameters([{ type: 'string' }], `0x${data.slice(10)}`)
      const readable = revealHiddenMessageCharacters(message.replace(/[\t\n\r\p{Zs}]+/gu, ' ').trim(), WALLET_REVERT_MESSAGE_MAX_LENGTH)
      if (!readable.text) return { kind: 'no-reason' }
      return { kind: 'message', message: readable.text, ...(readable.truncated ? { truncated: true as const } : {}) }
    } catch {
      // Not a well-formed Error(string); report the selector below.
    }
  }
  if (data.length <= MAX_REVERT_DATA_HEX_LENGTH && selector === PANIC_SELECTOR) {
    try {
      const [code] = decodeAbiParameters([{ type: 'uint256' }], `0x${data.slice(10)}`)
      return { kind: 'panic', code: `0x${code.toString(16)}` }
    } catch {
      // Not a well-formed Panic(uint256); report the selector below.
    }
  }
  return { kind: 'custom-error', selector }
}

/**
 * The revert reason stored in an approval record's simulation error, which
 * older versions read as plain text. Undefined when the reason does not fit.
 */
export function storedSimulationRevert(revert: WalletSimulationRevert): string | undefined {
  const parsed = WalletSimulationRevertSchema.safeParse(revert)
  if (!parsed.success) return undefined
  const { name: _name, meaning: _meaning, ...stored } = parsed.data as WalletSimulationRevert & { name?: string; meaning?: string }
  const text = `${STORED_REVERT_PREFIX}${JSON.stringify(stored)}`
  return text.length <= MAX_STORED_SIMULATION_ERROR_LENGTH ? text : undefined
}

/**
 * Reads a stored revert reason back and names a known custom error or panic
 * code. Undefined for any other simulation error, including those of older
 * versions, which never start with the revert prefix.
 */
export function simulationRevertFromStored(error: string | undefined): WalletSimulationRevert | undefined {
  if (!error?.startsWith(STORED_REVERT_PREFIX) || error.length > MAX_STORED_SIMULATION_ERROR_LENGTH) return undefined
  let value: unknown
  try {
    value = JSON.parse(error.slice(STORED_REVERT_PREFIX.length))
  } catch {
    return undefined
  }
  const parsed = WalletSimulationRevertSchema.safeParse(value)
  if (!parsed.success) return undefined
  const revert = parsed.data
  if (revert.kind === 'panic') {
    const meaning = PANIC_MEANINGS[revert.code]
    return { kind: 'panic', code: revert.code, ...(meaning ? { meaning } : {}) }
  }
  if (revert.kind === 'custom-error') {
    const name = CUSTOM_ERROR_NAMES.get(revert.selector)
    return { kind: 'custom-error', selector: revert.selector, ...(name ? { name } : {}) }
  }
  return revert
}
