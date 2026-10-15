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
const maxUint160 = (2n ** 160n - 1n).toString()
const maxUint256 = (2n ** 256n - 1n).toString()

describe('typed data in the trusted approval', () => {
  it('summarizes ordinary typed data without warnings', () => {
    expect(typedDataDisplay({
      domain: { name: 'Ether Mail', version: '1', chainId: 11155111, verifyingContract: '0xCcCCccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC' },
      primaryType: 'Mail',
      types: {},
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
    expect(typedDataDisplay({ domain: { chainId }, primaryType: 'Login', message: {} }, wallet)?.warnings).toEqual(['typed-data-other-chain'])
  })

  it('accepts the wallet chain as a hex string', () => {
    expect(typedDataDisplay({ domain: { chainId: '0xaa36a7' }, primaryType: 'Login', message: {} }, wallet)?.warnings).toEqual([])
  })

  it('shows the spender and amount of an ERC-20 permit', () => {
    expect(typedDataDisplay({
      domain: { name: 'USD Coin', version: '2', chainId: 11155111, verifyingContract: token },
      primaryType: 'Permit',
      message: { owner: wallet.publicAddress, spender, value: '1000000', nonce: 0, deadline: 1_800_000_000 }
    }, wallet)).toMatchObject({
      permit: { spender, allowances: [{ token, amount: '1000000' }] },
      warnings: ['token-permit']
    })
  })

  it('marks an unlimited ERC-20 permit', () => {
    const display = typedDataDisplay({
      domain: { chainId: 11155111, verifyingContract: token }, primaryType: 'Permit',
      message: { owner: wallet.publicAddress, spender, value: maxUint256, nonce: 0, deadline: 1_800_000_000 }
    }, wallet)
    expect(display?.permit?.allowances).toEqual([{ token, amount: maxUint256, unlimited: true }])
    expect(display?.warnings).toEqual(['token-permit', 'unlimited-amount'])
  })

  it('treats a DAI-style allowed permit as unlimited', () => {
    expect(typedDataDisplay({
      domain: { chainId: 11155111, verifyingContract: token }, primaryType: 'Permit',
      message: { holder: wallet.publicAddress, spender, nonce: 0, expiry: 0, allowed: true }
    }, wallet)).toMatchObject({ permit: { spender, allowances: [{ token, unlimited: true }] }, warnings: ['token-permit', 'unlimited-amount'] })
  })

  it('reads Permit2 single and batch allowances', () => {
    expect(typedDataDisplay({
      domain: { name: 'Permit2', chainId: 11155111, verifyingContract: permit2 }, primaryType: 'PermitSingle',
      message: { details: { token, amount: maxUint160, expiration: 0, nonce: 0 }, spender, sigDeadline: 0 }
    }, wallet)).toMatchObject({ permit: { spender, allowances: [{ token, amount: maxUint160, unlimited: true }] }, warnings: ['token-permit', 'unlimited-amount'] })

    const batch = Array.from({ length: 17 }, (_, index) => ({ token: `0x${index.toString(16).padStart(40, '0')}`, amount: '5', expiration: 0, nonce: 0 }))
    const display = typedDataDisplay({
      domain: { chainId: 11155111, verifyingContract: permit2 }, primaryType: 'PermitBatch',
      message: { details: batch, spender, sigDeadline: 0 }
    }, wallet)
    expect(display?.permit?.allowances).toHaveLength(16)
    expect(display?.permit?.moreAllowances).toBe(true)
    expect(display?.warnings).toEqual(['token-permit'])
  })

  it('reads Permit2 signature transfers', () => {
    expect(typedDataDisplay({
      domain: { chainId: 11155111, verifyingContract: permit2 }, primaryType: 'PermitWitnessTransferFrom',
      message: { permitted: { token, amount: '42' }, spender, nonce: 1, deadline: 0, witness: {} }
    }, wallet)).toMatchObject({ permit: { spender, allowances: [{ token, amount: '42' }] }, warnings: ['token-permit'] })
  })

  it('still warns about a permit whose fields it cannot read', () => {
    expect(typedDataDisplay({ domain: {}, primaryType: 'PermitSingle', message: { details: 'odd' } }, wallet))
      .toEqual({ primaryType: 'PermitSingle', domain: {}, permit: { allowances: [] }, warnings: ['token-permit'] })
  })

  it('bounds page-supplied text and ignores non-object typed data', () => {
    const display = typedDataDisplay({ domain: { name: 'x'.repeat(1_000) }, primaryType: 'y'.repeat(1_000), message: {} }, wallet)
    expect(display?.domain.name).toHaveLength(256)
    expect(display?.primaryType).toHaveLength(256)
    expect(typedDataDisplay('not typed data', wallet)).toBeUndefined()
    expect(typedDataDisplay(null, wallet)).toBeUndefined()
  })
})
