import {
  WALLET_TYPED_DATA_MAX_ALLOWANCES,
  type WalletDescriptor,
  type WalletTypedDataDisplay,
  type WalletTypedDataWarning
} from '../../shared/wallet.js'
import { revealHiddenMessageCharacters } from './policy.js'

const MAX_TEXT = 256
const MAX_INTEGER_TEXT = 300
// Permit2 allowances are uint160; ERC-20 permits commonly use the uint256 maximum.
const UNLIMITED_AMOUNT = 2n ** 160n - 1n
const PERMIT2_DETAILS_TYPES = new Set(['PermitSingle', 'PermitBatch'])
const PERMIT2_TRANSFER_TYPES = new Set([
  'PermitTransferFrom',
  'PermitBatchTransferFrom',
  'PermitWitnessTransferFrom',
  'PermitBatchWitnessTransferFrom'
])
// EIP-3009 authorizations move tokens directly to a recipient.
const TRANSFER_AUTHORIZATION_TYPES = new Set(['TransferWithAuthorization', 'ReceiveWithAuthorization'])

type Allowance = NonNullable<WalletTypedDataDisplay['tokenAccess']>['allowances'][number]
type Types = Record<string, unknown>
interface Field { type: string; value: unknown }

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

function text(value: unknown): string | undefined {
  if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'bigint' && typeof value !== 'boolean') return undefined
  return revealHiddenMessageCharacters(String(value), MAX_TEXT).text
}

/**
 * The integer the signer encodes for a uint or int field (it converts the
 * value with BigInt), or undefined when it cannot be read.
 */
function integer(value: unknown): bigint | undefined {
  if (typeof value === 'bigint') return value
  if (typeof value === 'boolean') return value ? 1n : 0n
  if (typeof value === 'number') return Number.isInteger(value) ? BigInt(value) : undefined
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (trimmed.length > MAX_INTEGER_TEXT || !/^(?:0x[0-9a-f]+|0o[0-7]+|0b[01]+|[+-]?\d+)$/i.test(trimmed)) return undefined
  return BigInt(trimmed)
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
    ...(parsed !== undefined && parsed >= UNLIMITED_AMOUNT ? { unlimited: true as const } : {})
  }
}

function structEntries(types: Types, field: Field | undefined): Array<Map<string, Field>> {
  if (!field) return []
  const list = /^(.+)\[\d*\]$/.exec(field.type)
  const values = list ? (Array.isArray(field.value) ? field.value : []) : [field.value]
  return values.map((value) => declaredFields(types, list?.[1] ?? field.type, value))
}

function tokenAccess(types: Types, primaryType: string, message: unknown, verifyingContract: unknown): WalletTypedDataDisplay['tokenAccess'] {
  const fields = declaredFields(types, primaryType, message)
  let allowances: Allowance[]
  let party: { spender?: string } | { recipient?: string }
  if (primaryType === 'Permit') {
    const allowed = fields.get('allowed')
    // DAI-style permits approve all or nothing with a declared `allowed` flag.
    allowances = allowed?.type === 'bool'
      ? [{ ...amount(verifyingContract, undefined), ...(allowed.value === true ? { unlimited: true as const } : allowed.value === false ? { amount: '0' } : {}) }]
      : [amount(verifyingContract, fields.get('value'))]
    party = { spender: text(fields.get('spender')?.value) }
  } else if (PERMIT2_DETAILS_TYPES.has(primaryType) || PERMIT2_TRANSFER_TYPES.has(primaryType)) {
    const entries = structEntries(types, fields.get(PERMIT2_DETAILS_TYPES.has(primaryType) ? 'details' : 'permitted'))
    allowances = entries.map((entry) => amount(entry.get('token')?.value, entry.get('amount')))
    party = { spender: text(fields.get('spender')?.value) }
  } else if (TRANSFER_AUTHORIZATION_TYPES.has(primaryType)) {
    allowances = [amount(verifyingContract, fields.get('value'))]
    party = { recipient: text(fields.get('to')?.value) }
  } else {
    return undefined
  }
  return {
    ...Object.fromEntries(Object.entries(party).filter(([, value]) => value !== undefined)),
    allowances: allowances.slice(0, WALLET_TYPED_DATA_MAX_ALLOWANCES),
    ...(allowances.length > WALLET_TYPED_DATA_MAX_ALLOWANCES ? { moreAllowances: true as const } : {})
  }
}

/**
 * What an EIP-712 request asks to sign, for the trusted approval dialog:
 * its type and signed domain fields, the spender or recipient and tokens of
 * a token permit or transfer authorization, and warnings for those, for
 * unlimited amounts and for a domain on another chain. The typed data comes
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
    if (access.allowances.some((entry) => entry.unlimited)) warnings.push('unlimited-amount')
  }
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
    ...(access ? { tokenAccess: access } : {}),
    warnings
  }
}
