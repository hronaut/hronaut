import { describe, expect, it } from 'vitest'
import { transactionWarnings } from '../src/main/wallet/transaction-display.js'
import type { WalletDecodedOperation } from '../src/main/wallet/policy.js'

function decoded(method: string, unlimitedAllowance = false): WalletDecodedOperation {
  return { understood: true, method, unlimitedAllowance, newContractOrProgram: false, blindMessage: false }
}

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
