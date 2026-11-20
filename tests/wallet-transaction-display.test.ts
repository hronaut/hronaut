import { describe, expect, it } from 'vitest'
import { isUnlimitedTokenAmount, transactionWarnings, walletNativeSymbol, wholeTokenAmount } from '../src/main/wallet/transaction-display.js'
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

describe('wholeTokenAmount', () => {
  it('reads a token amount with the decimals the token reported', () => {
    expect(wholeTokenAmount({ tokenAmount: '5000000', tokenDecimals: 6 })).toBe('5')
    expect(wholeTokenAmount({ tokenAmount: '5', tokenDecimals: 6 })).toBe('0.000005')
    expect(wholeTokenAmount({ tokenAmount: '1234500000000000000', tokenDecimals: 18 })).toBe('1.2345')
    expect(wholeTokenAmount({ tokenAmount: '7', tokenDecimals: 0 })).toBe('7')
    expect(wholeTokenAmount({ tokenAmount: (2n ** 256n - 1n).toString(), tokenDecimals: 77 })).toMatch(/^1\.\d+$/)
  })

  it('has no whole amount without usable decimals', () => {
    expect(wholeTokenAmount({ tokenAmount: '5000000' })).toBeUndefined()
    expect(wholeTokenAmount({ tokenDecimals: 6 })).toBeUndefined()
    expect(wholeTokenAmount({ tokenAmount: '5', tokenDecimals: 78 })).toBeUndefined()
    expect(wholeTokenAmount({ tokenAmount: '5', tokenDecimals: -1 })).toBeUndefined()
    expect(wholeTokenAmount({ tokenAmount: '5', tokenDecimals: 1.5 })).toBeUndefined()
    expect(wholeTokenAmount({ tokenAmount: '0x5', tokenDecimals: 6 })).toBeUndefined()
  })
})

describe('walletNativeSymbol', () => {
  const evm = (id: string) => ({ chainFamily: 'evm' as const, network: { id, name: 'Network', environment: 'testnet' as const, rpcUrl: 'http://127.0.0.1:8545' } })

  it('names the currency of known networks', () => {
    expect(walletNativeSymbol(evm('1'))).toBe('ETH')
    expect(walletNativeSymbol(evm('11155111'))).toBe('ETH')
    expect(walletNativeSymbol(evm('31337'))).toBe('ETH')
    expect(walletNativeSymbol(evm('137'))).toBe('POL')
    expect(walletNativeSymbol(evm('56'))).toBe('BNB')
    expect(walletNativeSymbol({ ...evm('mainnet'), chainFamily: 'solana' })).toBe('SOL')
    expect(walletNativeSymbol({ ...evm('mainnet'), chainFamily: 'tron' })).toBe('TRX')
  })

  it('names none for an unknown network or a chain ID two networks share with different currencies', () => {
    expect(walletNativeSymbol(evm('987654321987'))).toBeUndefined()
    expect(walletNativeSymbol(evm('1337'))).toBeUndefined()
  })
})
