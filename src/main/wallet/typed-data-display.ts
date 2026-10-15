import {
  WALLET_TYPED_DATA_MAX_ALLOWANCES,
  type WalletDescriptor,
  type WalletTypedDataDisplay,
  type WalletTypedDataWarning
} from '../../shared/wallet.js'
import { revealHiddenMessageCharacters } from './hidden-characters.js'
import { UNLIMITED_TOKEN_AMOUNT } from './transaction-display.js'

const MAX_TEXT = 256
// Long enough for zero-padded uint256 values; anything longer is reported as unreadable.
const MAX_INTEGER_TEXT = 4_096
const PERMIT2_DETAILS_TYPES = new Set(['PermitSingle', 'PermitBatch'])
const PERMIT2_TRANSFER_TYPES = new Set([
  'PermitTransferFrom',
  'PermitBatchTransferFrom',
  'PermitWitnessTransferFrom',
  'PermitBatchWitnessTransferFrom'
])
// EIP-3009 authorizations move tokens directly to a recipient.
const TRANSFER_AUTHORIZATION_TYPES = new Set(['TransferWithAuthorization', 'ReceiveWithAuthorization'])
// Marketplace and exchange orders that anyone can fill to take what they offer:
// Seaport and its bulk listings, Blur (and its bulk Root), 1inch, CoW Protocol
// and 0x (Order), 1inch RFQ, 0x v4 and LooksRare. Matching by name may also warn
// about an unrelated "Order", which errs on the side of caution.
const ASSET_ORDER_TYPES = new Set([
  'OrderComponents',
  'BulkOrder',
  'Order',
  'Root',
  'OrderRFQ',
  'LimitOrder',
  'RfqOrder',
  'OtcOrder',
  'ERC721Order',
  'ERC1155Order',
  'Maker',
  'MakerOrder',
  'BatchOrder'
])
// A Safe multisig transaction can move the Safe's assets or change its owners,
// and a Safe message makes the Safe accept any signature it wraps, such as a
// permit for the Safe's tokens.
const SAFE_TYPES = new Set(['SafeTx', 'SafeMessage'])
// Meta-transactions: someone else submits the signed call and the target
// contract treats it as coming from this account, so it can move tokens like a
// transaction. ERC-2771 forwarders (OpenZeppelin, GSN, Biconomy), Gelato's
// ERC-2771 relay calls, native meta-transactions (Biconomy, Polygon PoS
// tokens), 0x gasless calls, and ERC-4337 user operations signed as typed data
// (EntryPoint v0.8 and Safe's 4337 module).
const FORWARDED_CALL_TYPES = new Set([
  'ForwardRequest',
  'ERC20ForwardRequest',
  'RelayRequest',
  'SponsoredCallERC2771',
  'SponsoredCallConcurrentERC2771',
  'CallWithSyncFeeERC2771',
  'CallWithSyncFeeConcurrentERC2771',
  'MetaTransaction',
  'MetaTransactionDataV2',
  'PackedUserOperation',
  'SafeOp'
])
// A forwarder can accept a request type under any name (GSN's forwarder lets
// anyone register one), so a type that signs the call's encoded data in one of
// these fields counts as a meta-transaction too.
const CALL_DATA_FIELDS = new Set(['data', 'callData', 'calldata', 'functionSignature'])
// Deadlines past the year 9999, such as Permit2's uint48 maximum or a uint256
// maximum, are how permits say "no expiry"; they also cannot be shown as a date.
const LAST_DISPLAYABLE_SECOND = 253_402_300_799n
const NEVER = 'never'

type Allowance = NonNullable<WalletTypedDataDisplay['tokenAccess']>['allowances'][number]
type Types = Record<string, unknown>
interface Field { type: string; value: unknown }

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

// The signer hashes a string field's own text and accepts an address only as a string.
function text(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const visible = revealHiddenMessageCharacters(value, MAX_TEXT - 1)
  return visible.truncated ? `${visible.text}…` : visible.text
}

/**
 * The integer the signer encodes for a uint or int field, or undefined when
 * it cannot be read. The signer converts the value with BigInt, which also
 * reads an array or byte array through its text form, so this does too.
 */
function integer(value: unknown): bigint | undefined {
  if (typeof value === 'bigint') return value
  if (typeof value === 'boolean') return value ? 1n : 0n
  if (typeof value === 'number') return Number.isInteger(value) ? BigInt(value) : undefined
  let source: unknown = value
  if (value !== null && typeof value === 'object') {
    try {
      source = String(value)
    } catch {
      return undefined
    }
  }
  if (typeof source !== 'string' || source.length > MAX_INTEGER_TEXT) return undefined
  try {
    return BigInt(source)
  } catch {
    return undefined
  }
}

function integerText(value: bigint | undefined): string | undefined {
  const decimal = value?.toString()
  return decimal !== undefined && decimal.length <= MAX_TEXT ? decimal : undefined
}

/**
 * Only the fields a struct type declares are signed; other keys in the
 * page's message are ignored by the signer, so they must not change the
 * summary either.
 */
function declaredFields(types: Types, typeName: string, value: unknown): Map<string, Field> {
  const fields = new Map<string, Field>()
  const declaration = types[typeName]
  const values = record(value)
  if (!Array.isArray(declaration) || !values) return fields
  for (const entry of declaration) {
    const field = record(entry)
    if (typeof field?.name === 'string' && typeof field.type === 'string' && !fields.has(field.name)) {
      fields.set(field.name, { type: field.type, value: values[field.name] })
    }
  }
  return fields
}

// The domain fields the signer hashes: the declared EIP712Domain type, or
// the ones it infers from the domain object when none is declared.
function domainFields(types: Types, domain: Record<string, unknown>): Map<string, Field> {
  if (Array.isArray(types.EIP712Domain)) return declaredFields(types, 'EIP712Domain', domain)
  const fields = new Map<string, Field>()
  if (typeof domain.name === 'string') fields.set('name', { type: 'string', value: domain.name })
  if (domain.version) fields.set('version', { type: 'string', value: domain.version })
  if (typeof domain.chainId === 'number' || typeof domain.chainId === 'bigint') fields.set('chainId', { type: 'uint256', value: domain.chainId })
  if (domain.verifyingContract) fields.set('verifyingContract', { type: 'address', value: domain.verifyingContract })
  return fields
}

function isInteger(field: Field | undefined): field is Field {
  return Boolean(field && /^u?int\d*$/.test(field.type))
}

function amount(token: unknown, field: Field | undefined): Allowance {
  const parsed = isInteger(field) ? integer(field.value) : undefined
  const tokenText = text(token)
  const amountText = integerText(parsed)
  return {
    ...(tokenText === undefined ? {} : { token: tokenText }),
    ...(amountText === undefined ? {} : { amount: amountText }),
    ...(parsed !== undefined && parsed >= UNLIMITED_TOKEN_AMOUNT ? { unlimited: true as const } : {})
  }
}

function structEntries(types: Types, field: Field | undefined): Array<Map<string, Field>> {
  if (!field) return []
  const list = /^(.+)\[\d*\]$/.exec(field.type)
  const values = list ? (Array.isArray(field.value) ? field.value : []) : [field.value]
  return values.map((value) => declaredFields(types, list?.[1] ?? field.type, value))
}

interface TokenAccess {
  display: NonNullable<WalletTypedDataDisplay['tokenAccess']>
  unlimited: boolean
  unreadable: boolean
}

type Expiry = bigint | typeof NEVER | undefined

/**
 * Seconds since the epoch in a declared integer field, or undefined when the
 * type declares no such field. A declared value that cannot be read is
 * treated as never expiring, the same caution as an unreadable amount.
 */
function seconds(field: Field | undefined): Expiry {
  if (!field) return undefined
  const value = isInteger(field) ? integer(field.value) : undefined
  return value !== undefined && value >= 0n ? value : NEVER
}

/**
 * The latest time a Permit2 allowance can be used. An entry's expiration of
 * zero ends the allowance in the block that submits it, which must happen
 * before the signature deadline; any other expiration bounds the allowance.
 */
function permit2Expiry(entries: Array<Map<string, Field>>, signatureDeadline: Expiry): Expiry {
  let latest: bigint | undefined
  for (const entry of entries) {
    const expiration = seconds(entry.get('expiration'))
    const effective = expiration === 0n ? signatureDeadline : expiration
    if (effective === NEVER) return NEVER
    if (effective === undefined) return undefined
    if (latest === undefined || effective > latest) latest = effective
  }
  return latest
}

function forwardedCall(types: Types, primaryType: string, message: unknown): boolean {
  if (FORWARDED_CALL_TYPES.has(primaryType)) return true
  const fields = declaredFields(types, primaryType, message)
  // A MetaMask Delegation Framework delegation lets its delegate make calls as
  // the delegator's account; a Compound-style vote delegation has no delegator.
  if (primaryType === 'Delegation' && fields.get('delegator')?.type === 'address') return true
  return [...fields].some(([name, field]) => field.type === 'bytes' && CALL_DATA_FIELDS.has(name))
}

function expiryDisplay(expiry: Expiry): { expiresAt: string } | { neverExpires: true } | undefined {
  if (expiry === undefined) return undefined
  if (expiry === NEVER || expiry > LAST_DISPLAYABLE_SECOND) return { neverExpires: true }
  return { expiresAt: new Date(Number(expiry) * 1000).toISOString() }
}

function tokenAccess(types: Types, primaryType: string, message: unknown, verifyingContract: unknown): TokenAccess | undefined {
  const fields = declaredFields(types, primaryType, message)
  let allowances: Allowance[]
  let party: { spender?: string } | { recipient?: string }
  let expiry: Expiry
  if (primaryType === 'Permit') {
    const allowed = fields.get('allowed')
    // DAI-style permits approve all or nothing with a declared `allowed` flag,
    // and an `expiry` of zero means the permit never expires.
    allowances = allowed?.type === 'bool'
      ? [{ ...amount(verifyingContract, undefined), ...(allowed.value === true ? { unlimited: true as const } : allowed.value === false ? { amount: '0' } : {}) }]
      : [amount(verifyingContract, fields.get('value'))]
    party = { spender: text(fields.get('spender')?.value) }
    if (allowed?.type === 'bool') {
      const daiExpiry = seconds(fields.get('expiry'))
      expiry = daiExpiry === 0n ? NEVER : daiExpiry
    } else {
      expiry = seconds(fields.get('deadline'))
    }
  } else if (PERMIT2_DETAILS_TYPES.has(primaryType) || PERMIT2_TRANSFER_TYPES.has(primaryType)) {
    const entries = structEntries(types, fields.get(PERMIT2_DETAILS_TYPES.has(primaryType) ? 'details' : 'permitted'))
    allowances = entries.map((entry) => amount(entry.get('token')?.value, entry.get('amount')))
    party = { spender: text(fields.get('spender')?.value) }
    expiry = PERMIT2_DETAILS_TYPES.has(primaryType)
      ? permit2Expiry(entries, seconds(fields.get('sigDeadline')))
      : seconds(fields.get('deadline'))
  } else if (TRANSFER_AUTHORIZATION_TYPES.has(primaryType)) {
    allowances = [amount(verifyingContract, fields.get('value'))]
    party = { recipient: text(fields.get('to')?.value) }
    // validBefore is exclusive: the last second it can be used is one earlier.
    const validBefore = seconds(fields.get('validBefore'))
    expiry = typeof validBefore === 'bigint' && validBefore > 0n ? validBefore - 1n : validBefore
  } else {
    return undefined
  }
  return {
    display: {
      kind: PERMIT2_TRANSFER_TYPES.has(primaryType) || TRANSFER_AUTHORIZATION_TYPES.has(primaryType) ? 'transfer' : 'allowance',
      ...Object.fromEntries(Object.entries(party).filter(([, value]) => value !== undefined)),
      allowances: allowances.slice(0, WALLET_TYPED_DATA_MAX_ALLOWANCES),
      ...(allowances.length > WALLET_TYPED_DATA_MAX_ALLOWANCES ? { moreAllowances: true as const } : {}),
      ...expiryDisplay(expiry)
    },
    // Judged on every entry, including those past the shown limit.
    unlimited: allowances.some((entry) => entry.unlimited),
    unreadable: allowances.length === 0 || allowances.some((entry) => entry.amount === undefined && !entry.unlimited)
  }
}

/**
 * The chain ID the signer hashes into the typed data's domain, or undefined
 * when the domain signs none or it cannot be read.
 */
export function typedDataSignedChainId(typedData: unknown): bigint | undefined {
  const definition = record(typedData)
  if (!definition) return undefined
  const field = domainFields(record(definition.types) ?? {}, record(definition.domain) ?? {}).get('chainId')
  return isInteger(field) ? integer(field.value) : undefined
}

/**
 * What an EIP-712 request asks to sign, for the trusted approval dialog:
 * its type and signed domain fields, the spender or recipient, tokens and
 * expiry of a token permit or transfer authorization, and warnings for those,
 * for unlimited amounts, for permits that never expire, for marketplace or exchange orders, Safe
 * transactions and meta-transactions, and for a domain on another chain. The typed data comes
 * from the page, so every field is treated as unknown, and only fields the
 * signer hashes are read.
 */
export function typedDataDisplay(typedData: unknown, wallet: WalletDescriptor): WalletTypedDataDisplay | undefined {
  const definition = record(typedData)
  if (!definition) return undefined
  const types = record(definition.types) ?? {}
  const primaryType = typeof definition.primaryType === 'string' ? definition.primaryType : ''
  const domain = domainFields(types, record(definition.domain) ?? {})
  const warnings: WalletTypedDataWarning[] = []
  const chainIdField = domain.get('chainId')
  const chainId = isInteger(chainIdField) ? integer(chainIdField.value) : undefined
  if (chainIdField && chainId?.toString() !== wallet.network.id) warnings.push('typed-data-other-chain')
  const verifyingContract = domain.get('verifyingContract')?.value
  const access = tokenAccess(types, primaryType, definition.message, verifyingContract)
  if (access) {
    warnings.push(TRANSFER_AUTHORIZATION_TYPES.has(primaryType) ? 'token-transfer' : 'token-permit')
    if (access.unlimited) warnings.push('unlimited-amount')
    if (access.unreadable) warnings.push('unreadable-amount')
    if (access.display.neverExpires) warnings.push('no-expiry')
  }
  if (ASSET_ORDER_TYPES.has(primaryType)) warnings.push('asset-order')
  if (SAFE_TYPES.has(primaryType)) warnings.push('safe-transaction')
  else if (forwardedCall(types, primaryType, definition.message)) warnings.push('forwarded-call')
  const name = text(domain.get('name')?.value)
  const version = text(domain.get('version')?.value)
  const chainIdText = integerText(chainId)
  const contract = text(verifyingContract)
  return {
    primaryType: text(primaryType) ?? '',
    domain: {
      ...(name === undefined ? {} : { name }),
      ...(version === undefined ? {} : { version }),
      ...(chainIdText === undefined ? {} : { chainId: chainIdText }),
      ...(contract === undefined ? {} : { verifyingContract: contract })
    },
    ...(access ? { tokenAccess: access.display } : {}),
    warnings
  }
}
