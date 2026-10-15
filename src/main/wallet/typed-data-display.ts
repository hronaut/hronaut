import {
  WALLET_TYPED_DATA_MAX_ALLOWANCES,
  type WalletDescriptor,
  type WalletTypedDataDisplay,
  type WalletTypedDataWarning
} from '../../shared/wallet.js'

const MAX_TEXT = 256
// Permit2 allowances are uint160; ERC-20 permits commonly use the uint256 maximum.
const UNLIMITED_AMOUNT = 2n ** 160n - 1n
const PERMIT_TYPES = new Set([
  'Permit',
  'PermitSingle',
  'PermitBatch',
  'PermitTransferFrom',
  'PermitBatchTransferFrom',
  'PermitWitnessTransferFrom',
  'PermitBatchWitnessTransferFrom'
])

type Allowance = NonNullable<WalletTypedDataDisplay['permit']>['allowances'][number]

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

function text(value: unknown): string | undefined {
  if (typeof value === 'string') return value.slice(0, MAX_TEXT)
  if (typeof value === 'number' || typeof value === 'bigint' || typeof value === 'boolean') return String(value).slice(0, MAX_TEXT)
  return undefined
}

function integer(value: unknown): bigint | undefined {
  try {
    if (typeof value === 'bigint') return value
    if (typeof value === 'number') return Number.isSafeInteger(value) ? BigInt(value) : undefined
    if (typeof value === 'string' && /^(?:0x[0-9a-f]{1,64}|\d{1,78})$/i.test(value.trim())) return BigInt(value.trim())
  } catch {
    // Not an integer.
  }
  return undefined
}

function allowance(token: unknown, amount: unknown): Allowance {
  const parsed = integer(amount)
  return {
    ...(text(token) === undefined ? {} : { token: text(token) }),
    ...(parsed === undefined ? (text(amount) === undefined ? {} : { amount: text(amount) }) : { amount: parsed.toString().slice(0, MAX_TEXT) }),
    ...(parsed !== undefined && parsed >= UNLIMITED_AMOUNT ? { unlimited: true as const } : {})
  }
}

function permitAllowances(primaryType: string, message: Record<string, unknown>, verifyingContract: unknown): Allowance[] {
  if (primaryType === 'Permit') {
    // DAI-style permits approve all or nothing with an `allowed` flag.
    if (typeof message.allowed === 'boolean') {
      return [{ ...allowance(verifyingContract, undefined), ...(message.allowed ? { unlimited: true as const } : { amount: '0' }) }]
    }
    return [allowance(verifyingContract, message.value)]
  }
  const details = primaryType === 'PermitSingle' || primaryType === 'PermitBatch' ? message.details : message.permitted
  const entries = Array.isArray(details) ? details : [details]
  return entries.flatMap((entry) => {
    const fields = record(entry)
    return fields ? [allowance(fields.token, fields.amount)] : []
  })
}

/**
 * What an EIP-712 request asks to sign, for the trusted approval dialog:
 * its type and domain, the spender and tokens of a token permit, and
 * warnings for permits, unlimited amounts and a domain on another chain.
 * The typed data comes from the page, so every field is treated as unknown.
 */
export function typedDataDisplay(typedData: unknown, wallet: WalletDescriptor): WalletTypedDataDisplay | undefined {
  const definition = record(typedData)
  if (!definition) return undefined
  const primaryType = text(definition.primaryType) ?? ''
  const domain = record(definition.domain) ?? {}
  const message = record(definition.message) ?? {}
  const warnings: WalletTypedDataWarning[] = []
  if (domain.chainId !== undefined) {
    const chainId = integer(domain.chainId)
    if (chainId === undefined || chainId.toString() !== wallet.network.id) warnings.push('typed-data-other-chain')
  }
  let permit: WalletTypedDataDisplay['permit']
  if (PERMIT_TYPES.has(primaryType)) {
    warnings.push('token-permit')
    const allowances = permitAllowances(primaryType, message, domain.verifyingContract)
    if (allowances.some((entry) => entry.unlimited)) warnings.push('unlimited-amount')
    permit = {
      ...(text(message.spender) === undefined ? {} : { spender: text(message.spender) }),
      allowances: allowances.slice(0, WALLET_TYPED_DATA_MAX_ALLOWANCES),
      ...(allowances.length > WALLET_TYPED_DATA_MAX_ALLOWANCES ? { moreAllowances: true as const } : {})
    }
  }
  const chainId = integer(domain.chainId)
  return {
    primaryType,
    domain: {
      ...(text(domain.name) === undefined ? {} : { name: text(domain.name) }),
      ...(text(domain.version) === undefined ? {} : { version: text(domain.version) }),
      ...(domain.chainId === undefined ? {} : { chainId: chainId === undefined ? text(domain.chainId) ?? 'invalid' : chainId.toString() }),
      ...(text(domain.verifyingContract) === undefined ? {} : { verifyingContract: text(domain.verifyingContract) })
    },
    ...(permit ? { permit } : {}),
    warnings
  }
}
