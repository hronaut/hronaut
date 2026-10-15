// A small typed-data request can make viem's hashTypedData run for seconds:
// every struct it encodes re-encodes that struct's whole type graph, so an
// array of structs whose fields name many types multiplies the two. This
// estimates that work before hashing, so a website cannot stall the main
// process with typed data the policy would then sign.

const MAX_DEPTH = 32
// Calibrated against viem 2.57: about one microsecond per unit for each shape.
// Per-struct cost for each type in its graph, on top of the encoded type text.
const TYPE_COST = 16
// Encoding one value such as an integer or address.
const VALUE_COST = 8
// Characters of string or bytes text hashed per unit.
const TEXT_UNIT = 4

class Stop extends Error {}

function inferredDomainFields(domain: unknown): Array<{ name: string; type: string }> {
  const fields = Object(domain ?? {}) as Record<string, unknown>
  return [
    typeof fields.name === 'string' && { name: 'name', type: 'string' },
    Boolean(fields.version) && { name: 'version', type: 'string' },
    (typeof fields.chainId === 'number' || typeof fields.chainId === 'bigint') && { name: 'chainId', type: 'uint256' },
    Boolean(fields.verifyingContract) && { name: 'verifyingContract', type: 'address' },
    Boolean(fields.salt) && { name: 'salt', type: 'bytes32' }
  ].filter((field): field is { name: string; type: string } => Boolean(field))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Whether hashing this typed data stays within budget work units. It follows
 * viem's hashTypedData in order, the domain and then the message, and counts
 * for each struct it encodes the length of the struct's encoded type and its
 * type graph, plus each field and long text values. It stops where viem would
 * throw, counting the work viem did before that, and errs on the high side
 * elsewhere, so a request within budget hashes quickly or fails fast.
 */
export function typedDataHashWithinBudget(typedData: unknown, budget: number): boolean {
  if (!isRecord(typedData)) return true
  const domain = typedData.domain === undefined ? {} : typedData.domain
  // Like viem: an inferred domain type that declared types can replace. Spread
  // exactly as viem does, since an array of types also spreads into names.
  const types: Record<string, unknown> = {
    EIP712Domain: inferredDomainFields(domain),
    ...(typedData.types as object)
  }
  const weights = new Map<string, number | Stop>()
  let work = 0

  const add = (units: number): void => {
    work += units
    if (work > budget) throw new RangeError('typed-data-over-budget')
  }

  // The encoded type text and graph size viem builds each time it encodes this
  // struct, or Stop when building it throws.
  const weight = (type: string): number => {
    const cached = weights.get(type)
    if (typeof cached === 'number') return cached
    if (cached) throw cached
    const seen = new Set<string>()
    const pending = [type]
    let total = 0
    try {
      while (pending.length) {
        const name = pending.pop()!
        if (seen.has(name) || types[name] === undefined) continue
        const fields = types[name]
        if (!Object.hasOwn(types, name) || !Array.isArray(fields)) throw new Stop()
        seen.add(name)
        total += TYPE_COST + name.length + 2
        add(1 + fields.length)
        for (const field of fields) {
          if (!isRecord(field) || typeof field.type !== 'string') throw new Stop()
          total += field.type.length + String(field.name).length + 2
          pending.push(/^\w*/u.exec(field.type)?.[0] ?? '')
        }
      }
    } catch (error) {
      if (error instanceof Stop) weights.set(type, error)
      throw error
    }
    weights.set(type, total)
    return total
  }

  const visit = (type: string, value: unknown, depth: number): void => {
    add(1)
    if (depth > MAX_DEPTH) throw new RangeError('typed-data-too-deep')
    if (types[type] !== undefined) {
      add(weight(type))
      const fields = types[type] as Array<{ name: unknown; type: string }>
      if (fields.length && value == null) throw new Stop()
      for (const field of fields) visit(field.type, Object(value)[String(field.name)], depth + 1)
      return
    }
    if (type.lastIndexOf(']') === type.length - 1 && type !== 'bytes' && type !== 'string') {
      if (!Array.isArray(value)) throw new Stop()
      const item = type.slice(0, type.lastIndexOf('['))
      for (const entry of value) visit(item, entry, depth + 1)
      return
    }
    add(VALUE_COST + (typeof value === 'string' ? Math.ceil(value.length / TEXT_UNIT) : 0))
  }

  try {
    if (domain) visit('EIP712Domain', domain, 0)
    if (typedData.primaryType !== 'EIP712Domain' && typeof typedData.primaryType === 'string') {
      visit(typedData.primaryType, typedData.message, 0)
    }
  } catch (error) {
    if (error instanceof Stop) return true
    return false
  }
  return true
}
