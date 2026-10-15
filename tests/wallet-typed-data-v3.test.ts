import { describe, expect, it } from 'vitest'
import { encodeAbiParameters, hashTypedData, keccak256, toBytes, toHex, type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { typedDataV3MatchesV4 } from '../src/main/wallet/typed-data-v3.js'

// The EIP-712 specification's example, signed there with the key keccak256("cow").
const mail = {
  types: {
    EIP712Domain: [
      { name: 'name', type: 'string' }, { name: 'version', type: 'string' },
      { name: 'chainId', type: 'uint256' }, { name: 'verifyingContract', type: 'address' }
    ],
    Person: [{ name: 'name', type: 'string' }, { name: 'wallet', type: 'address' }],
    Mail: [{ name: 'from', type: 'Person' }, { name: 'to', type: 'Person' }, { name: 'contents', type: 'string' }]
  },
  primaryType: 'Mail',
  domain: { name: 'Ether Mail', version: '1', chainId: 1, verifyingContract: '0xCcCCccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC' },
  message: {
    from: { name: 'Cow', wallet: '0xCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826' },
    to: { name: 'Bob', wallet: '0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB' },
    contents: 'Hello, Bob!'
  }
} as const

type Fields = ReadonlyArray<{ name: string; type: string }>

/** MetaMask's v3 encoder (eth-sig-util): skips fields without a value and has no arrays. */
function v3Hash(data: { types: Record<string, Fields>; primaryType: string; domain: Record<string, unknown>; message: Record<string, unknown> }): Hex {
  const dependencies = (type: string, found = new Set<string>()): Set<string> => {
    if (found.has(type) || !data.types[type]) return found
    found.add(type)
    for (const field of data.types[type]!) dependencies(field.type, found)
    return found
  }
  const encodeType = (type: string): string => {
    const [primary, ...rest] = [...dependencies(type)]
    return [primary!, ...rest.sort()].map((name) => `${name}(${data.types[name]!.map((field) => `${field.type} ${field.name}`).join(',')})`).join('')
  }
  const hashStruct = (type: string, value: Record<string, unknown>): Hex => {
    const types: Array<{ type: string }> = [{ type: 'bytes32' }]
    const values: unknown[] = [keccak256(toHex(encodeType(type)))]
    for (const field of data.types[type]!) {
      const entry = value[field.name]
      if (entry === undefined) continue
      if (field.type === 'string') { types.push({ type: 'bytes32' }); values.push(keccak256(toHex(entry as string))) }
      else if (field.type === 'bytes') { types.push({ type: 'bytes32' }); values.push(keccak256(entry as Hex)) }
      else if (data.types[field.type]) { types.push({ type: 'bytes32' }); values.push(hashStruct(field.type, entry as Record<string, unknown>)) }
      else { types.push({ type: field.type }); values.push(field.type.startsWith('uint') || field.type.startsWith('int') ? BigInt(entry as number) : entry) }
    }
    return keccak256(encodeAbiParameters(types, values))
  }
  return keccak256(`0x1901${hashStruct('EIP712Domain', data.domain).slice(2)}${hashStruct(data.primaryType, data.message).slice(2)}`)
}

describe('eth_signTypedData_v3 compatibility', () => {
  it('signs the EIP-712 example as published, since v3 and v4 hash it the same', async () => {
    expect(typedDataV3MatchesV4(mail)).toBe(true)
    expect(hashTypedData(mail as never)).toBe(v3Hash(mail as never))
    expect(hashTypedData(mail as never)).toBe('0xbe609aee343fb3c4b28e1df9e632fca64fcfaede20f02e86244efddf30957bd2')
    const cow = privateKeyToAccount(keccak256(toBytes('cow')))
    expect(cow.address).toBe('0xCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826')
    expect(await cow.signTypedData(mail as never)).toBe(
      '0x4355c47d63924e8a72e509b65029052eb6c299d53a04e167c5775fd466751c9d07299936d304c153f6443dfa05f40ff007d72911b6f72307f996231605b915621c'
    )
  })

  it('refuses v3 typed data that v3 and v4 would hash differently', () => {
    // v3 has no arrays.
    expect(typedDataV3MatchesV4({ ...mail, types: { ...mail.types, Mail: [...mail.types.Mail, { name: 'cc', type: 'Person[]' }] } })).toBe(false)
    // v3 skips a missing field, v4 rejects it, and v4 encodes a missing struct as zero.
    const withoutContents = { ...mail, message: { from: mail.message.from, to: mail.message.to } }
    expect(typedDataV3MatchesV4(withoutContents)).toBe(false)
    expect(hashTypedData({ ...mail, types: { ...mail.types, Mail: mail.types.Mail.slice(0, 2) }, message: withoutContents.message } as never))
      .not.toBe(v3Hash(withoutContents as never))
    expect(typedDataV3MatchesV4({ ...mail, message: { ...mail.message, to: null } })).toBe(false)
    expect(typedDataV3MatchesV4({ ...mail, message: { ...mail.message, to: { name: 'Bob' } } })).toBe(false)
    // A domain field the type declares but the domain leaves out.
    expect(typedDataV3MatchesV4({ ...mail, domain: { name: 'Ether Mail', version: '1', chainId: 1 } })).toBe(false)
    // MetaMask hashes an undeclared domain type as empty; viem infers it from the domain.
    const { EIP712Domain: _domain, ...withoutDomainType } = mail.types
    expect(typedDataV3MatchesV4({ ...mail, types: withoutDomainType })).toBe(false)
    // Fields beyond the declared ones are ignored by both.
    expect(typedDataV3MatchesV4({ ...mail, message: { ...mail.message, extra: 1 } })).toBe(true)
  })

  it('leaves malformed typed data to the v4 checks', () => {
    expect(typedDataV3MatchesV4('not typed data')).toBe(true)
    expect(typedDataV3MatchesV4({ primaryType: 'Mail' })).toBe(true)
  })
})
