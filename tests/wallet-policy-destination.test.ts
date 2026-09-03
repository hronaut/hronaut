import { describe, expect, it } from 'vitest'
import { walletPolicyDestinationMatches } from '../src/main/wallet/policy.js'

describe('walletPolicyDestinationMatches', () => {
  it('normalizes EVM address casing', () => {
    expect(walletPolicyDestinationMatches(
      'evm',
      ['0xAbCd000000000000000000000000000000000001'],
      '0xaBcD000000000000000000000000000000000001'
    )).toBe(true)
  })

  it.each([
    ['solana', 'So11111111111111111111111111111111111111112', 'so11111111111111111111111111111111111111112'],
    ['tron', 'TJRabPrwbZy45sbavfcjinPJC18kjpRTv8', 'tJRabPrwbZy45sbavfcjinPJC18kjpRTv8']
  ] as const)('matches %s destinations case-sensitively', (chainFamily, destination, changedCase) => {
    expect(walletPolicyDestinationMatches(chainFamily, [destination], destination)).toBe(true)
    expect(walletPolicyDestinationMatches(chainFamily, [destination], changedCase)).toBe(false)
  })
})
