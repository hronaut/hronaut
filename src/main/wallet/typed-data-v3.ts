// eth_signTypedData_v3 is EIP-712 before arrays were added. MetaMask's v3
// encoder skips a field that has no value, while v4 (which Hronaut signs with
// viem) rejects it or encodes a missing struct as zero, and an undeclared
// EIP712Domain type is inferred by viem but empty in MetaMask. So v3 typed data
// is signed as v4 only when the two hash the same: no array types, a declared
// EIP712Domain, and a value for every declared field, nested structs included.

const MAX_DEPTH = 32

export const TYPED_DATA_V3_UNSUPPORTED =
  'Unsupported EVM wallet method: eth_signTypedData_v3 with arrays, an undeclared EIP712Domain or missing fields, use eth_signTypedData_v4'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function fieldsOf(types: Record<string, unknown>, type: string): Array<{ name: unknown; type: unknown }> | undefined {
  const fields = Object.hasOwn(types, type) ? types[type] : undefined
  return Array.isArray(fields) ? fields.filter(isRecord) as Array<{ name: unknown; type: unknown }> : undefined
}

/** Whether v3 and v4 hash this typed data the same; anything malformed is left to the v4 checks. */
export function typedDataV3MatchesV4(typedData: unknown): boolean {
  if (!isRecord(typedData) || !isRecord(typedData.types)) return true
  const types = typedData.types
  for (const fields of Object.values(types)) {
    if (!Array.isArray(fields)) continue
    if (fields.some((field) => isRecord(field) && typeof field.type === 'string' && field.type.trimEnd().endsWith(']'))) return false
  }
  if (!fieldsOf(types, 'EIP712Domain')) return false

  const complete = (type: string, value: unknown, depth: number): boolean => {
    const fields = fieldsOf(types, type)
    if (!fields) return true
    if (!isRecord(value) || depth > MAX_DEPTH) return false
    return fields.every((field) => {
      if (typeof field.name !== 'string') return true
      const entry = Object.hasOwn(value, field.name) ? value[field.name] : undefined
      if (entry === undefined || entry === null) return false
      return typeof field.type !== 'string' || complete(field.type, entry, depth + 1)
    })
  }
  return complete('EIP712Domain', typedData.domain ?? {}, 0)
    && (typeof typedData.primaryType !== 'string' || typedData.primaryType === 'EIP712Domain'
      || complete(typedData.primaryType, typedData.message, 0))
}
