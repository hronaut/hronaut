import { hashTypedData } from 'viem'
import { describe, expect, it } from 'vitest'
import { WEBSITE_TYPED_DATA_MAX_WORK } from '../src/main/wallet/policy.js'
import { typedDataHashWithinBudget } from '../src/main/wallet/typed-data-cost.js'

const address = '0x000000000022D473030F116dDEE9F6B43aC78BA3'
const within = (typedData: unknown) => typedDataHashWithinBudget(JSON.parse(JSON.stringify(typedData)), WEBSITE_TYPED_DATA_MAX_WORK)

function permit2Batch(count: number) {
  return {
    domain: { name: 'Permit2', chainId: 1, verifyingContract: address },
    primaryType: 'PermitBatch',
    types: {
      PermitBatch: [{ name: 'details', type: 'PermitDetails[]' }, { name: 'spender', type: 'address' }, { name: 'sigDeadline', type: 'uint256' }],
      PermitDetails: [{ name: 'token', type: 'address' }, { name: 'amount', type: 'uint160' }, { name: 'expiration', type: 'uint48' }, { name: 'nonce', type: 'uint48' }]
    },
    message: { details: Array(count).fill({ token: address, amount: '1', expiration: '1', nonce: '0' }), spender: address, sigDeadline: '1' }
  }
}

function seaportOrder(items: number) {
  const item = [{ name: 'itemType', type: 'uint8' }, { name: 'token', type: 'address' }, { name: 'identifierOrCriteria', type: 'uint256' }, { name: 'startAmount', type: 'uint256' }, { name: 'endAmount', type: 'uint256' }]
  const offer = { itemType: '1', token: address, identifierOrCriteria: '0', startAmount: '1', endAmount: '1' }
  return {
    domain: { name: 'Seaport', version: '1.6', chainId: 1, verifyingContract: address },
    primaryType: 'OrderComponents',
    types: {
      OrderComponents: [
        { name: 'offerer', type: 'address' }, { name: 'zone', type: 'address' }, { name: 'offer', type: 'OfferItem[]' },
        { name: 'consideration', type: 'ConsiderationItem[]' }, { name: 'orderType', type: 'uint8' }, { name: 'startTime', type: 'uint256' },
        { name: 'endTime', type: 'uint256' }, { name: 'zoneHash', type: 'bytes32' }, { name: 'salt', type: 'uint256' },
        { name: 'conduitKey', type: 'bytes32' }, { name: 'counter', type: 'uint256' }
      ],
      OfferItem: item,
      ConsiderationItem: [...item, { name: 'recipient', type: 'address' }]
    },
    message: {
      offerer: address, zone: address, offer: Array(items).fill(offer), consideration: Array(items).fill({ ...offer, recipient: address }),
      orderType: '0', startTime: '0', endTime: '1', zoneHash: `0x${'00'.repeat(32)}`, salt: '0', conduitKey: `0x${'00'.repeat(32)}`, counter: '0'
    }
  }
}

// Each item makes viem re-encode a type graph of `width` empty types, which takes seconds for a few kilobytes.
function wideGraph(width: number, items: number) {
  const types: Record<string, Array<{ name: string; type: string }>> = { M: [{ name: 'a', type: 'A[]' }], A: [] }
  for (let index = 0; index < width; index++) {
    types.A!.push({ name: `f${index}`, type: `T${index}` })
    types[`T${index}`] = []
  }
  return { domain: { chainId: 1 }, primaryType: 'M', types, message: { a: Array(items).fill(0) } }
}

describe('typed-data hashing budget', () => {
  it('fits real permits and orders well within the website budget', () => {
    expect(within(permit2Batch(16))).toBe(true)
    expect(within(seaportOrder(50))).toBe(true)
    expect(() => hashTypedData(seaportOrder(50) as Parameters<typeof hashTypedData>[0])).not.toThrow()
  })

  it('refuses typed data whose struct encodes re-encode a large type graph', () => {
    // 2,000 items of a 201-type graph took about 15 s to hash; this smaller one still takes over a second.
    expect(within(wideGraph(200, 200))).toBe(false)
    expect(within(wideGraph(200, 2000))).toBe(false)
    expect(within(wideGraph(5, 10))).toBe(true)
    // viem spreads an array of types into numbered type names, so it is just as slow.
    const { types, ...rest } = wideGraph(200, 200)
    const numbered = Object.keys(types).sort((left, right) => left.localeCompare(right))
    const rename = (type: string) => type.replace(/^\w+/u, (name) => String(numbered.indexOf(name)))
    const asArray = numbered.map((name) => types[name]!.map((field) => ({ ...field, type: rename(field.type) })))
    expect(within({ ...rest, types: asArray, primaryType: rename('M') })).toBe(false)
  })

  it('counts long text and long type names', () => {
    expect(within({ domain: {}, primaryType: 'M', types: { M: [{ name: 'a', type: 'string[]' }] }, message: { a: Array(100).fill('x'.repeat(5000)) } })).toBe(false)
    expect(within({ domain: {}, primaryType: 'M', types: { M: [{ name: 'a', type: 'string[]' }] }, message: { a: Array(10).fill('x'.repeat(100)) } })).toBe(true)
  })

  it('stops counting where the signer throws, and refuses nesting deeper than real typed data', () => {
    // viem throws on the first item, whose struct reads a field of undefined.
    const throwing = { domain: {}, primaryType: 'M', types: { M: [{ name: 'a', type: 'A[]' }], A: [{ name: 'b', type: 'B' }], B: [{ name: 'c', type: 'uint256' }] }, message: { a: Array(100_000).fill(0) } }
    expect(within(throwing)).toBe(true)
    expect(() => hashTypedData(throwing as Parameters<typeof hashTypedData>[0])).toThrow()
    expect(within({ domain: {}, primaryType: 'M', types: { M: 'not a list' }, message: {} })).toBe(true)
    let nested: unknown = '1'
    for (let depth = 0; depth < 40; depth++) nested = [nested]
    expect(within({ domain: {}, primaryType: 'M', types: { M: [{ name: 'a', type: `uint256${'[]'.repeat(40)}` }] }, message: { a: nested } })).toBe(false)
  })
})
