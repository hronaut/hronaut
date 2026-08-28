const TYPE_KEY = '__hronautWalletType'
const VALUE_KEY = 'value'

function nullRecord(): Record<string, unknown> {
  return Object.create(null) as Record<string, unknown>
}

function tagged(type: 'bigint' | 'bytes' | 'object', value: unknown): Record<string, unknown> {
  const output = nullRecord()
  output[TYPE_KEY] = type
  output[VALUE_KEY] = value
  return output
}

function hasExactTagShape(value: Record<string, unknown>, type: string): boolean {
  const keys = Object.keys(value)
  return keys.length === 2 && keys.includes(TYPE_KEY) && keys.includes(VALUE_KEY) && value[TYPE_KEY] === type
}

export function walletJsonSafe(value: unknown, depth = 0): unknown {
  if (depth > 32) throw new Error('Wallet request nesting is too deep')
  if (typeof value === 'bigint') return tagged('bigint', value.toString())
  if (value instanceof Uint8Array) return tagged('bytes', Buffer.from(value).toString('base64'))
  if (Array.isArray(value)) return value.map((entry) => walletJsonSafe(entry, depth + 1))
  if (!value || typeof value !== 'object') return value
  const output = nullRecord()
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) output[key] = walletJsonSafe(entry, depth + 1)
  return tagged('object', output)
}

export function restoreWalletJson(value: unknown, depth = 0): unknown {
  if (depth > 32) throw new Error('Wallet request nesting is too deep')
  if (Array.isArray(value)) return value.map((entry) => restoreWalletJson(entry, depth + 1))
  if (!value || typeof value !== 'object') return value
  const object = value as Record<string, unknown>
  if (hasExactTagShape(object, 'bigint') && typeof object[VALUE_KEY] === 'string' && /^\d+$/.test(object[VALUE_KEY])) {
    return BigInt(object[VALUE_KEY])
  }
  if (hasExactTagShape(object, 'bytes') && typeof object[VALUE_KEY] === 'string' && /^[A-Za-z0-9+/]+={0,2}$/.test(object[VALUE_KEY])) {
    const bytes = Buffer.from(object[VALUE_KEY], 'base64')
    if (bytes.toString('base64') !== object[VALUE_KEY]) throw new Error('Wallet request byte encoding is invalid')
    return bytes
  }
  if (!hasExactTagShape(object, 'object') || !object[VALUE_KEY] || typeof object[VALUE_KEY] !== 'object' || Array.isArray(object[VALUE_KEY])) {
    throw new Error('Wallet request object encoding is invalid')
  }
  const output = nullRecord()
  for (const [key, entry] of Object.entries(object[VALUE_KEY] as Record<string, unknown>)) {
    output[key] = restoreWalletJson(entry, depth + 1)
  }
  return output
}

export function walletJsonInspectable(value: unknown, depth = 0): unknown {
  if (depth > 32) throw new Error('Wallet request nesting is too deep')
  if (typeof value === 'bigint') return value.toString()
  if (value instanceof Uint8Array) {
    return { encoding: 'base64', value: Buffer.from(value).toString('base64') }
  }
  if (Array.isArray(value)) return value.map((entry) => walletJsonInspectable(entry, depth + 1))
  if (!value || typeof value !== 'object') return value
  const output = nullRecord()
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    output[key] = walletJsonInspectable(entry, depth + 1)
  }
  return output
}
