import { describe, expect, it } from 'vitest'
import { isUnlimitedTokenAmount, transactionWarnings } from '../src/main/wallet/transaction-display.js'
import type { WalletDecodedOperation } from '../src/main/wallet/policy.js'

function decoded(method: string, unlimitedAllowance = false): WalletDecodedOperation {
  return { understood: true, method, unlimitedAllowance, newContractOrProgram: false, blindMessage: false }
}

describe('isUnlimitedTokenAmount', () => {
  it('treats Permit2 maximum and above as unlimited, and one below as limited', () => {
    expect(isUnlimitedTokenAmount(2n ** 256n - 1n)).toBe(true)
    expect(isUnlimitedTokenAmount(2n ** 160n - 1n)).toBe(true)
    expect(isUnlimitedTokenAmount(2n ** 160n - 2n)).toBe(false)
    expect(isUnlimitedTokenAmount(0n)).toBe(false)
  })

  it('treats the exact maximum of a narrower allowance type, as UNI and COMP store it, as unlimited', () => {
    expect(isUnlimitedTokenAmount(2n ** 96n - 1n)).toBe(true)
    expect(isUnlimitedTokenAmount(2n ** 128n - 1n)).toBe(true)
    expect(isUnlimitedTokenAmount(2n ** 96n - 2n)).toBe(false)
    expect(isUnlimitedTokenAmount(2n ** 96n)).toBe(false)
    expect(isUnlimitedTokenAmount(2n ** 128n - 2n)).toBe(false)
  })
})

describe('transactionWarnings', () => {
  it('warns about token approvals and their unlimited amounts', () => {
    for (const method of ['erc20.approve', 'trc20.approve']) {
      expect(transactionWarnings(decoded(method))).toEqual(['token-approval'])
      expect(transactionWarnings(decoded(method, true))).toEqual(['token-approval', 'unlimited-allowance'])
    }
  })

  it('warns that an allowance increase adds to an existing allowance', () => {
    expect(transactionWarnings(decoded('erc20.increaseAllowance'))).toEqual(['allowance-increase'])
    expect(transactionWarnings(decoded('erc20.increaseAllowance', true))).toEqual(['allowance-increase', 'unlimited-allowance'])
  })

  it('warns about a collection-wide NFT approval but not its revocation', () => {
    expect(transactionWarnings(decoded('nft.setApprovalForAll', true))).toEqual(['collection-approval'])
    expect(transactionWarnings(decoded('nft.setApprovalForAll'))).toEqual([])
  })

  it('adds nothing for transfers, unknown calls or a record without a method', () => {
    for (const method of ['native-transfer', 'erc20.transfer', 'erc20.transferFrom', 'trc20.transfer', 'contract-call:0x12345678']) {
      expect(transactionWarnings(decoded(method))).toEqual([])
    }
    expect(transactionWarnings({ understood: false, unlimitedAllowance: true, newContractOrProgram: true, blindMessage: false })).toEqual([])
  })
})
