import { hashTypedData } from 'viem'
import { describe, expect, it } from 'vitest'
import { typedDataDisplay } from '../src/main/wallet/typed-data-display.js'
import type { WalletDescriptor } from '../src/shared/wallet.js'

const wallet: WalletDescriptor = {
  id: 'wallet-1',
  name: 'EVM test wallet',
  kind: 'managed',
  chainFamily: 'evm',
  publicAddress: '0x00000000000000000000000000000000000000Ab',
  network: { id: '11155111', name: 'Sepolia', environment: 'testnet', rpcUrl: 'https://rpc.sepolia.example' },
  capabilities: ['read', 'sign', 'send'],
  workspaceIds: ['workspace-1'],
  policyIds: [],
  recoveryConfirmed: true,
  createdAt: '2026-08-28T12:00:00.000Z',
  updatedAt: '2026-08-28T12:00:00.000Z'
}

const token = '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238'
const spender = '0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD'
const permit2 = '0x000000000022D473030F116dDEE9F6B43aC78BA3'
const owner = wallet.publicAddress.toLowerCase()
const maxUint160 = (2n ** 160n - 1n).toString()
const maxUint256 = (2n ** 256n - 1n).toString()

const domainType = [
  { name: 'name', type: 'string' },
  { name: 'version', type: 'string' },
  { name: 'chainId', type: 'uint256' },
  { name: 'verifyingContract', type: 'address' }
]
const erc2612Types = {
  EIP712Domain: domainType,
  Permit: [
    { name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }, { name: 'value', type: 'uint256' },
    { name: 'nonce', type: 'uint256' }, { name: 'deadline', type: 'uint256' }
  ]
}
const daiTypes = {
  EIP712Domain: domainType,
  Permit: [
    { name: 'holder', type: 'address' }, { name: 'spender', type: 'address' }, { name: 'nonce', type: 'uint256' },
    { name: 'expiry', type: 'uint256' }, { name: 'allowed', type: 'bool' }
  ]
}
const permitDetails = [
  { name: 'token', type: 'address' }, { name: 'amount', type: 'uint160' },
  { name: 'expiration', type: 'uint48' }, { name: 'nonce', type: 'uint48' }
]
const permitSingleTypes = {
  PermitSingle: [{ name: 'details', type: 'PermitDetails' }, { name: 'spender', type: 'address' }, { name: 'sigDeadline', type: 'uint256' }],
  PermitDetails: permitDetails
}
const permitBatchTypes = {
  PermitBatch: [{ name: 'details', type: 'PermitDetails[]' }, { name: 'spender', type: 'address' }, { name: 'sigDeadline', type: 'uint256' }],
  PermitDetails: permitDetails
}
const transferAuthorizationTypes = {
  EIP712Domain: domainType,
  TransferWithAuthorization: [
    { name: 'from', type: 'address' }, { name: 'to', type: 'address' }, { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' }, { name: 'validBefore', type: 'uint256' }, { name: 'nonce', type: 'bytes32' }
  ]
}
const usdc = { name: 'USD Coin', version: '2', chainId: 11155111, verifyingContract: token }
const erc2612Message = { owner, spender, value: '1000000', nonce: 0, deadline: 1_800_000_000 }
const daiMessage = { holder: owner, spender, nonce: 0, expiry: 0, allowed: true }

// What the wallet signs, computed the way the broker's signer computes it.
function signedHash(typedData: object): string {
  return hashTypedData(typedData as Parameters<typeof hashTypedData>[0])
}

describe('typed data in the trusted approval', () => {
  it('summarizes ordinary typed data without warnings', () => {
    expect(typedDataDisplay({
      domain: { name: 'Ether Mail', version: '1', chainId: 11155111, verifyingContract: '0xCcCCccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC' },
      primaryType: 'Mail',
      types: { Mail: [{ name: 'contents', type: 'string' }] },
      message: { contents: 'Hello' }
    }, wallet)).toEqual({
      primaryType: 'Mail',
      domain: { name: 'Ether Mail', version: '1', chainId: '11155111', verifyingContract: '0xCcCCccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC' },
      warnings: []
    })
  })

  it.each([
    ['another chain', 1],
    ['a hex chain ID for another chain', '0x1'],
    ['an unreadable chain ID', 'sepolia']
  ])('warns about a domain on %s', (_label, chainId) => {
    expect(typedDataDisplay({
      domain: { chainId }, primaryType: 'Login', types: { EIP712Domain: [{ name: 'chainId', type: 'uint256' }] }, message: {}
    }, wallet)?.warnings).toEqual(['typed-data-other-chain'])
  })

  it('accepts the wallet chain as a hex string', () => {
    expect(typedDataDisplay({
      domain: { chainId: '0xaa36a7' }, primaryType: 'Login', types: { EIP712Domain: [{ name: 'chainId', type: 'uint256' }] }, message: {}
    }, wallet)).toMatchObject({ domain: { chainId: '11155111' }, warnings: [] })
  })

  it('shows only the domain fields that are signed', () => {
    // A declared domain without chainId, and an undeclared domain whose chainId is a string, leave it unsigned.
    for (const typedData of [
      { domain: { name: 'App', chainId: 1 }, primaryType: 'Login', types: { EIP712Domain: [{ name: 'name', type: 'string' }], Login: [] }, message: {} },
      { domain: { name: 'App', chainId: '1' }, primaryType: 'Login', types: { Login: [] }, message: {} }
    ]) {
      expect(typedDataDisplay(typedData, wallet)).toEqual({ primaryType: 'Login', domain: { name: 'App' }, warnings: [] })
      expect(signedHash(typedData)).toBe(signedHash({ ...typedData, domain: { name: 'App' } }))
    }
  })

  it('shows the spender and amount of an ERC-20 permit', () => {
    expect(typedDataDisplay({ domain: usdc, primaryType: 'Permit', types: erc2612Types, message: erc2612Message }, wallet)).toEqual({
      primaryType: 'Permit',
      domain: { name: 'USD Coin', version: '2', chainId: '11155111', verifyingContract: token },
      tokenAccess: { spender, allowances: [{ token, amount: '1000000' }] },
      warnings: ['token-permit']
    })
  })

  it('marks an unlimited ERC-20 permit, and one just below the limit as limited', () => {
    const display = typedDataDisplay({
      domain: usdc, primaryType: 'Permit', types: erc2612Types, message: { ...erc2612Message, value: maxUint256 }
    }, wallet)
    expect(display?.tokenAccess?.allowances).toEqual([{ token, amount: maxUint256, unlimited: true }])
    expect(display?.warnings).toEqual(['token-permit', 'unlimited-amount'])

    const belowLimit = (2n ** 160n - 2n).toString()
    expect(typedDataDisplay({
      domain: usdc, primaryType: 'Permit', types: erc2612Types, message: { ...erc2612Message, value: belowLimit }
    }, wallet)).toMatchObject({ tokenAccess: { allowances: [{ token, amount: belowLimit }] }, warnings: ['token-permit'] })
  })

  it('treats a DAI-style permit as all or nothing', () => {
    expect(typedDataDisplay({ domain: usdc, primaryType: 'Permit', types: daiTypes, message: daiMessage }, wallet))
      .toMatchObject({ tokenAccess: { spender, allowances: [{ token, unlimited: true }] }, warnings: ['token-permit', 'unlimited-amount'] })
    expect(typedDataDisplay({ domain: usdc, primaryType: 'Permit', types: daiTypes, message: { ...daiMessage, allowed: false } }, wallet))
      .toMatchObject({ tokenAccess: { spender, allowances: [{ token, amount: '0' }] }, warnings: ['token-permit'] })
  })

  it('ignores message keys the permit type does not sign', () => {
    // An ERC-2612 permit for the maximum amount cannot pose as a revoked DAI permit.
    const unlimited = { domain: usdc, primaryType: 'Permit', types: erc2612Types, message: { ...erc2612Message, value: maxUint256 } }
    const disguised = { ...unlimited, message: { ...unlimited.message, allowed: false } }
    expect(signedHash(disguised)).toBe(signedHash(unlimited))
    expect(typedDataDisplay(disguised, wallet)).toEqual(typedDataDisplay(unlimited, wallet))
    expect(typedDataDisplay(disguised, wallet)?.warnings).toContain('unlimited-amount')

    // A DAI permit cannot show a small amount it does not sign.
    const dai = { domain: usdc, primaryType: 'Permit', types: daiTypes, message: daiMessage }
    const withValue = { ...dai, message: { ...daiMessage, value: '1' } }
    expect(signedHash(withValue)).toBe(signedHash(dai))
    expect(typedDataDisplay(withValue, wallet)).toEqual(typedDataDisplay(dai, wallet))

    // A Permit type that does not declare `value` has no readable amount, whatever the message says.
    expect(typedDataDisplay({
      domain: usdc, primaryType: 'Permit', types: { Permit: erc2612Types.Permit.filter(({ name }) => name !== 'value') }, message: erc2612Message
    }, wallet)?.tokenAccess?.allowances).toEqual([{ token }])
  })

  it.each([
    ['binary', `0b${'1'.repeat(160)}`],
    ['octal', `0o${(2n ** 160n - 1n).toString(8)}`],
    ['padded hex', `  0X${'F'.repeat(40)}\n`],
    ['signed decimal', `+${maxUint160}`]
  ])('reads a %s amount the way the signer encodes it', (_label, amount) => {
    const typedData = {
      domain: { chainId: 11155111, verifyingContract: permit2 }, primaryType: 'PermitSingle', types: permitSingleTypes,
      message: { details: { token, amount, expiration: 0, nonce: 0 }, spender, sigDeadline: 0 }
    }
    expect(signedHash(typedData)).toBe(signedHash({ ...typedData, message: { ...typedData.message, details: { ...typedData.message.details, amount: maxUint160 } } }))
    expect(typedDataDisplay(typedData, wallet)?.tokenAccess?.allowances).toEqual([{ token, amount: maxUint160, unlimited: true }])
  })

  it('reads a large JSON number amount as the integer the signer encodes', () => {
    const typedData = { domain: usdc, primaryType: 'Permit', types: erc2612Types, message: { ...erc2612Message, value: 1e60 } }
    expect(signedHash(typedData)).toBe(signedHash({ ...typedData, message: { ...erc2612Message, value: BigInt(1e60).toString() } }))
    expect(typedDataDisplay(typedData, wallet)?.tokenAccess?.allowances).toEqual([{ token, amount: BigInt(1e60).toString(), unlimited: true }])
  })

  it('reads Permit2 single and batch allowances', () => {
    expect(typedDataDisplay({
      domain: { name: 'Permit2', chainId: 11155111, verifyingContract: permit2 }, primaryType: 'PermitSingle', types: permitSingleTypes,
      message: { details: { token, amount: maxUint160, expiration: 0, nonce: 0 }, spender, sigDeadline: 0 }
    }, wallet)).toMatchObject({ tokenAccess: { spender, allowances: [{ token, amount: maxUint160, unlimited: true }] }, warnings: ['token-permit', 'unlimited-amount'] })

    const batch = Array.from({ length: 17 }, (_, index) => ({ token: `0x${index.toString(16).padStart(40, '0')}`, amount: '5', expiration: 0, nonce: 0 }))
    const display = typedDataDisplay({
      domain: { chainId: 11155111, verifyingContract: permit2 }, primaryType: 'PermitBatch', types: permitBatchTypes,
      message: { details: batch, spender, sigDeadline: 0 }
    }, wallet)
    expect(display?.tokenAccess?.allowances).toHaveLength(16)
    expect(display?.tokenAccess?.allowances[0]).toEqual({ token: batch[0]!.token, amount: '5' })
    expect(display?.tokenAccess?.moreAllowances).toBe(true)
    expect(display?.warnings).toEqual(['token-permit'])
  })

  it('reads Permit2 signature transfers', () => {
    expect(typedDataDisplay({
      domain: { chainId: 11155111, verifyingContract: permit2 }, primaryType: 'PermitWitnessTransferFrom',
      types: {
        PermitWitnessTransferFrom: [
          { name: 'permitted', type: 'TokenPermissions' }, { name: 'spender', type: 'address' }, { name: 'nonce', type: 'uint256' },
          { name: 'deadline', type: 'uint256' }, { name: 'witness', type: 'Order' }
        ],
        TokenPermissions: [{ name: 'token', type: 'address' }, { name: 'amount', type: 'uint256' }],
        Order: [{ name: 'id', type: 'uint256' }]
      },
      message: { permitted: { token, amount: '42' }, spender, nonce: 1, deadline: 0, witness: { id: 1 } }
    }, wallet)).toMatchObject({ tokenAccess: { spender, allowances: [{ token, amount: '42' }] }, warnings: ['token-permit'] })
  })

  it('shows the recipient and amount of an EIP-3009 transfer authorization', () => {
    expect(typedDataDisplay({
      domain: usdc, primaryType: 'TransferWithAuthorization', types: transferAuthorizationTypes,
      message: { from: owner, to: spender, value: '2500000', validAfter: 0, validBefore: 1_800_000_000, nonce: `0x${'1'.repeat(64)}` }
    }, wallet)).toEqual({
      primaryType: 'TransferWithAuthorization',
      domain: { name: 'USD Coin', version: '2', chainId: '11155111', verifyingContract: token },
      tokenAccess: { recipient: spender, allowances: [{ token, amount: '2500000' }] },
      warnings: ['token-transfer']
    })
  })

  it('still warns about a permit whose fields it cannot read', () => {
    expect(typedDataDisplay({ domain: {}, primaryType: 'PermitSingle', message: { details: 'odd' } }, wallet))
      .toEqual({ primaryType: 'PermitSingle', domain: {}, tokenAccess: { allowances: [] }, warnings: ['token-permit'] })
    for (const types of [null, 'types', [], { Permit: 'value' }, { Permit: [null, 7, { name: 'value' }, { name: 'value', type: 'uint256' }] }]) {
      expect(typedDataDisplay({ domain: {}, primaryType: 'Permit', types, message: { value: { amount: '1' } } }, wallet))
        .toEqual({ primaryType: 'Permit', domain: {}, tokenAccess: { allowances: [{}] }, warnings: ['token-permit'] })
    }
    expect(typedDataDisplay({
      domain: {}, primaryType: 'PermitSingle', types: permitSingleTypes, message: { details: [{ token, amount: '1' }], spender }
    }, wallet)?.tokenAccess).toEqual({ spender, allowances: [{}] })
  })

  it('leaves out an amount too long to show instead of cutting it', () => {
    const display = typedDataDisplay({
      domain: usdc, primaryType: 'Permit', types: erc2612Types, message: { ...erc2612Message, value: `0x${'f'.repeat(290)}` }
    }, wallet)
    expect(display?.tokenAccess?.allowances).toEqual([{ token, unlimited: true }])
    expect(typedDataDisplay({
      domain: usdc, primaryType: 'Permit', types: erc2612Types, message: { ...erc2612Message, value: '9'.repeat(301) }
    }, wallet)?.tokenAccess?.allowances).toEqual([{ token }])
  })

  it('bounds page-supplied text, reveals hidden characters and ignores non-object typed data', () => {
    const display = typedDataDisplay({ domain: { name: 'x'.repeat(1_000) }, primaryType: 'y'.repeat(1_000), message: {} }, wallet)
    expect(display?.domain.name).toHaveLength(256)
    expect(display?.primaryType).toHaveLength(256)
    expect(typedDataDisplay({ domain: { name: 'USD‮Coin' }, primaryType: 'Login', message: {} }, wallet)?.domain.name).toBe('USD[U+202E]Coin')
    expect(typedDataDisplay('not typed data', wallet)).toBeUndefined()
    expect(typedDataDisplay(null, wallet)).toBeUndefined()
  })
})
