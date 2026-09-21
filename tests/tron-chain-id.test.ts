import { describe, expect, it } from 'vitest'
import { normalizeTronProviderChainId, tronProviderChainId } from '../src/shared/tron-chain-id.js'

describe('Tron provider chain IDs', () => {
  it.each([
    ['mainnet', '0x2b6653dc'],
    ['nile', '0xcd8690dc'],
    ['shasta', '0x94a9059e'],
    ['2494104990', '0x94a9059e'],
    ['0xCD8690DC', '0xcd8690dc']
  ])('normalizes %s to %s', (networkId, expected) => {
    expect(tronProviderChainId(networkId)).toBe(expected)
  })

  it.each(['private', '0X2b6653dc', '0x00', '-1', '1.5', `0x1${'0'.repeat(64)}`])(
    'rejects non-canonical or unavailable chain ID %s',
    (networkId) => expect(tronProviderChainId(networkId)).toBeUndefined()
  )

  it('keeps internal network aliases out of provider request normalization', () => {
    expect(normalizeTronProviderChainId('shasta')).toBeUndefined()
    expect(normalizeTronProviderChainId('0x94a9059e')).toBe('0x94a9059e')
  })
})
