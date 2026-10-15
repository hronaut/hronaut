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
      tokenAccess: { kind: 'allowance', spender, allowances: [{ token, amount: '1000000' }], expiresAt: '2027-01-15T08:00:00.000Z' },
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
      .toMatchObject({ tokenAccess: { spender, allowances: [{ token, unlimited: true }], neverExpires: true }, warnings: ['token-permit', 'unlimited-amount', 'no-expiry'] })
    expect(typedDataDisplay({ domain: usdc, primaryType: 'Permit', types: daiTypes, message: { ...daiMessage, allowed: false, expiry: 1_800_000_000 } }, wallet))
      .toMatchObject({ tokenAccess: { spender, allowances: [{ token, amount: '0' }], expiresAt: '2027-01-15T08:00:00.000Z' }, warnings: ['token-permit'] })
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
    }, wallet)).toMatchObject({ tokenAccess: { allowances: [{ token }] }, warnings: ['token-permit', 'unreadable-amount'] })
  })

  it('reads every amount value the signer accepts, and warns when it cannot', () => {
    // The page sends JSON, so arrays are the shape that matters: the signer reads ['5'] as 5.
    const candidates: unknown[] = [
      '1', ' 0x10 ', '', '  ', '+3', '-1', '1.5', 1.5, 1e60, true, false, null, {}, [], ['5'], [['7']], [1, 2], [maxUint256],
      `${'0'.repeat(300)}${maxUint160}`, `0x${'0'.repeat(300)}${'f'.repeat(64)}`, '0b101', '0o17', 'ff', '1_000', 'abc',
      Buffer.from('42'), maxUint256, (2n ** 256n).toString()
    ]
    for (const value of candidates) {
      const typedData = { domain: usdc, primaryType: 'Permit', types: erc2612Types, message: { ...erc2612Message, value } }
      const display = typedDataDisplay(typedData, wallet)
      let hash: string
      try {
        hash = signedHash(typedData)
      } catch {
        continue
      }
      const [allowance] = display?.tokenAccess?.allowances ?? []
      expect(allowance?.amount, JSON.stringify(value)).toBeDefined()
      expect(signedHash({ ...typedData, message: { ...erc2612Message, value: allowance!.amount } }), JSON.stringify(value)).toBe(hash)
      expect(Boolean(allowance!.unlimited), JSON.stringify(value)).toBe(BigInt(allowance!.amount!) >= 2n ** 160n - 1n)
      expect(display?.warnings, JSON.stringify(value)).not.toContain('unreadable-amount')
    }
  })

  it.each([
    ['binary', `0b${'1'.repeat(160)}`],
    ['octal', `0o${(2n ** 160n - 1n).toString(8)}`],
    ['padded hex', `  0X${'F'.repeat(40)}\n`],
    ['signed decimal', `+${maxUint160}`],
    ['zero-padded', `${'0'.repeat(400)}${maxUint160}`],
    ['one-item array', [maxUint160]]
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

  it('warns about an unlimited Permit2 allowance listed after the shown ones', () => {
    const details = [
      ...Array.from({ length: 16 }, (_, index) => ({ token: `0x${(index + 1).toString(16).padStart(40, '0')}`, amount: '1', expiration: 0, nonce: 0 })),
      { token, amount: maxUint160, expiration: 0, nonce: 0 }
    ]
    const typedData = {
      domain: { chainId: 11155111, verifyingContract: permit2 }, primaryType: 'PermitBatch', types: permitBatchTypes,
      message: { details, spender, sigDeadline: 0 }
    }
    expect(() => signedHash(typedData)).not.toThrow()
    const display = typedDataDisplay(typedData, wallet)
    expect(display?.tokenAccess?.allowances.some((entry) => entry.unlimited)).toBe(false)
    expect(display?.tokenAccess?.moreAllowances).toBe(true)
    expect(display?.warnings).toEqual(['token-permit', 'unlimited-amount'])
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
    }, wallet)).toMatchObject({ tokenAccess: { kind: 'transfer', spender, allowances: [{ token, amount: '42' }] }, warnings: ['token-permit'] })
  })

  it('shows the recipient and amount of an EIP-3009 transfer authorization', () => {
    expect(typedDataDisplay({
      domain: usdc, primaryType: 'TransferWithAuthorization', types: transferAuthorizationTypes,
      message: { from: owner, to: spender, value: '2500000', validAfter: 0, validBefore: 1_800_000_000, nonce: `0x${'1'.repeat(64)}` }
    }, wallet)).toEqual({
      primaryType: 'TransferWithAuthorization',
      domain: { name: 'USD Coin', version: '2', chainId: '11155111', verifyingContract: token },
      // validBefore is exclusive, so the last usable second is one earlier.
      tokenAccess: { kind: 'transfer', recipient: spender, allowances: [{ token, amount: '2500000' }], expiresAt: '2027-01-15T07:59:59.000Z' },
      warnings: ['token-transfer']
    })
  })

  it('shows until when a permit can be used, and warns when it never expires', () => {
    const permit = (deadline: string | number) => typedDataDisplay({
      domain: usdc, primaryType: 'Permit', types: erc2612Types, message: { ...erc2612Message, deadline }
    }, wallet)
    expect(permit(maxUint256)).toMatchObject({ tokenAccess: { neverExpires: true }, warnings: ['token-permit', 'no-expiry'] })
    // The last second that still reads as a date, and the first that does not.
    expect(permit(253_402_300_799)?.tokenAccess).toMatchObject({ expiresAt: '9999-12-31T23:59:59.000Z' })
    expect(permit(253_402_300_800)?.tokenAccess).toMatchObject({ neverExpires: true })
    // A deadline the summary cannot read is treated as never expiring, like an
    // unreadable amount, even when the signer reads it as an ordinary time.
    expect(permit('soon')).toMatchObject({ tokenAccess: { neverExpires: true }, warnings: ['token-permit', 'no-expiry'] })
    expect(permit(`0x${'0'.repeat(4_100)}1`)).toMatchObject({ tokenAccess: { neverExpires: true }, warnings: ['token-permit', 'no-expiry'] })
    const paddedDai = { domain: usdc, primaryType: 'Permit', types: daiTypes, message: { ...daiMessage, expiry: '0'.repeat(4_097) } }
    expect(signedHash(paddedDai)).toBe(signedHash({ ...paddedDai, message: daiMessage }))
    expect(typedDataDisplay(paddedDai, wallet)?.warnings).toContain('no-expiry')
    // A type that declares no deadline shows no validity row.
    expect(typedDataDisplay({
      domain: usdc, primaryType: 'Permit', types: { ...erc2612Types, Permit: erc2612Types.Permit.filter(field => field.name !== 'deadline') }, message: erc2612Message
    }, wallet)?.tokenAccess).not.toHaveProperty('neverExpires')

    // Permit2: an allowance lasts until its expiration, and one of zero ends
    // in the block that submits it, so the signature deadline bounds it.
    const permit2Single = (expiration: number | string, sigDeadline: number | string) => typedDataDisplay({
      domain: { name: 'Permit2', chainId: 11155111, verifyingContract: permit2 }, primaryType: 'PermitSingle', types: permitSingleTypes,
      message: { details: { token, amount: '5', expiration, nonce: 0 }, spender, sigDeadline }
    }, wallet)?.tokenAccess
    expect(permit2Single(1_800_000_000, 1_700_000_000)).toMatchObject({ expiresAt: '2027-01-15T08:00:00.000Z' })
    expect(permit2Single(0, 1_800_000_000)).toMatchObject({ expiresAt: '2027-01-15T08:00:00.000Z' })
    expect(permit2Single((2n ** 48n - 1n).toString(), 1_700_000_000)).toMatchObject({ neverExpires: true })
    const batch = typedDataDisplay({
      domain: { chainId: 11155111, verifyingContract: permit2 }, primaryType: 'PermitBatch', types: permitBatchTypes,
      message: { details: [{ token, amount: '1', expiration: 1_700_000_000, nonce: 0 }, { token, amount: '1', expiration: 1_800_000_000, nonce: 0 }], spender, sigDeadline: 0 }
    }, wallet)
    expect(batch?.tokenAccess?.expiresAt).toBe('2027-01-15T08:00:00.000Z')
    const paddedBatch = typedDataDisplay({
      domain: { chainId: 11155111, verifyingContract: permit2 }, primaryType: 'PermitBatch', types: permitBatchTypes,
      message: { details: [{ token, amount: '1', expiration: 1_700_000_000, nonce: 0 }, { token, amount: '1', expiration: '0'.repeat(4_097), nonce: 0 }], spender, sigDeadline: 'unreadable' }
    }, wallet)
    expect(paddedBatch?.tokenAccess?.neverExpires).toBe(true)
  })

  it('warns that a marketplace or exchange order or a Safe transaction can move assets', () => {
    const offerItem = [
      { name: 'itemType', type: 'uint8' }, { name: 'token', type: 'address' }, { name: 'identifierOrCriteria', type: 'uint256' },
      { name: 'startAmount', type: 'uint256' }, { name: 'endAmount', type: 'uint256' }
    ]
    const seaport = {
      domain: { name: 'Seaport', version: '1.6', chainId: 11155111, verifyingContract: permit2 },
      primaryType: 'OrderComponents',
      types: {
        EIP712Domain: domainType,
        OrderComponents: [{ name: 'offerer', type: 'address' }, { name: 'offer', type: 'OfferItem[]' }, { name: 'counter', type: 'uint256' }],
        OfferItem: offerItem
      },
      message: { offerer: owner, offer: [{ itemType: 2, token, identifierOrCriteria: 7, startAmount: 1, endAmount: 1 }], counter: 0 }
    }
    expect(() => hashTypedData(seaport as Parameters<typeof hashTypedData>[0])).not.toThrow()
    expect(typedDataDisplay(seaport, wallet)).toEqual({
      primaryType: 'OrderComponents',
      domain: { name: 'Seaport', version: '1.6', chainId: '11155111', verifyingContract: permit2 },
      warnings: ['asset-order']
    })
    for (const primaryType of ['BulkOrder', 'Order', 'Root', 'OrderRFQ', 'LimitOrder', 'RfqOrder', 'OtcOrder', 'ERC721Order', 'ERC1155Order', 'Maker', 'MakerOrder', 'BatchOrder']) {
      expect(typedDataDisplay({ domain: {}, primaryType, types: { [primaryType]: [] }, message: {} }, wallet)?.warnings, primaryType).toEqual(['asset-order'])
    }
    const safeTx = {
      domain: { chainId: 11155111, verifyingContract: spender },
      primaryType: 'SafeTx',
      types: {
        SafeTx: [
          { name: 'to', type: 'address' }, { name: 'value', type: 'uint256' }, { name: 'data', type: 'bytes' }, { name: 'operation', type: 'uint8' },
          { name: 'safeTxGas', type: 'uint256' }, { name: 'baseGas', type: 'uint256' }, { name: 'gasPrice', type: 'uint256' },
          { name: 'gasToken', type: 'address' }, { name: 'refundReceiver', type: 'address' }, { name: 'nonce', type: 'uint256' }
        ]
      },
      message: { to: token, value: 0, data: '0x', operation: 0, safeTxGas: 0, baseGas: 0, gasPrice: 0, gasToken: owner, refundReceiver: owner, nonce: 3 }
    }
    expect(() => hashTypedData(safeTx as Parameters<typeof hashTypedData>[0])).not.toThrow()
    expect(typedDataDisplay(safeTx, wallet)?.warnings).toEqual(['safe-transaction'])
    // A Safe message makes the Safe accept whatever signature it wraps.
    expect(typedDataDisplay({
      domain: { chainId: 11155111, verifyingContract: spender }, primaryType: 'SafeMessage',
      types: { SafeMessage: [{ name: 'message', type: 'bytes' }] }, message: { message: '0x1234' }
    }, wallet)?.warnings).toEqual(['safe-transaction'])
    // A plain login or vote is not an order.
    expect(typedDataDisplay({ domain: {}, primaryType: 'Login', types: { Login: [] }, message: {} }, wallet)?.warnings).toEqual([])
  })

  it('still warns about a permit whose fields it cannot read', () => {
    expect(typedDataDisplay({ domain: {}, primaryType: 'PermitSingle', message: { details: 'odd' } }, wallet))
      .toEqual({ primaryType: 'PermitSingle', domain: {}, tokenAccess: { kind: 'allowance', allowances: [] }, warnings: ['token-permit', 'unreadable-amount'] })
    for (const types of [null, 'types', [], { Permit: 'value' }, { Permit: [null, 7, { name: 'value' }, { name: 'value', type: 'uint256' }] }]) {
      expect(typedDataDisplay({ domain: {}, primaryType: 'Permit', types, message: { value: { amount: '1' } } }, wallet))
        .toEqual({ primaryType: 'Permit', domain: {}, tokenAccess: { kind: 'allowance', allowances: [{}] }, warnings: ['token-permit', 'unreadable-amount'] })
    }
    expect(typedDataDisplay({
      domain: {}, primaryType: 'PermitSingle', types: permitSingleTypes, message: { details: [{ token, amount: '1' }], spender }
    }, wallet)).toMatchObject({ tokenAccess: { spender, allowances: [{}] }, warnings: ['token-permit', 'unreadable-amount'] })
  })

  it('leaves out an amount too long to show instead of cutting it', () => {
    const display = typedDataDisplay({
      domain: usdc, primaryType: 'Permit', types: erc2612Types, message: { ...erc2612Message, value: `0x${'f'.repeat(290)}` }
    }, wallet)
    expect(display?.tokenAccess?.allowances).toEqual([{ token, unlimited: true }])
    expect(display?.warnings).toEqual(['token-permit', 'unlimited-amount'])
    expect(typedDataDisplay({
      domain: usdc, primaryType: 'Permit', types: erc2612Types, message: { ...erc2612Message, value: '9'.repeat(4_097) }
    }, wallet)).toMatchObject({ tokenAccess: { allowances: [{ token }] }, warnings: ['token-permit', 'unreadable-amount'] })
  })

  it('bounds page-supplied text, reveals hidden characters and ignores non-object typed data', () => {
    const display = typedDataDisplay({ domain: { name: 'x'.repeat(1_000) }, primaryType: 'y'.repeat(1_000), message: {} }, wallet)
    expect(display?.domain.name).toBe(`${'x'.repeat(255)}…`)
    expect(display?.primaryType).toBe(`${'y'.repeat(255)}…`)
    expect(typedDataDisplay({ domain: { name: 'USD‮Coin' }, primaryType: 'Login', message: {} }, wallet)?.domain.name).toBe('USD[U+202E]Coin')
    // A string field is signed as its own text, so a number there is not shown as if it were that text.
    const numericName = { domain: { name: 123 }, primaryType: 'Login', types: { EIP712Domain: [{ name: 'name', type: 'string' }], Login: [] }, message: {} }
    expect(signedHash(numericName)).not.toBe(signedHash({ ...numericName, domain: { name: '123' } }))
    expect(typedDataDisplay(numericName, wallet)?.domain).toEqual({})
    expect(typedDataDisplay('not typed data', wallet)).toBeUndefined()
    expect(typedDataDisplay(null, wallet)).toBeUndefined()
  })
})
