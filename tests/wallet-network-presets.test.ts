import { describe, expect, it } from 'vitest'
import { WalletNetworkSchema } from '../src/shared/wallet.js'
import {
  WALLET_NETWORK_PRESETS,
  walletNetworkPresetsFor
} from '../src/shared/wallet-network-presets.js'

describe('wallet network presets', () => {
  it('provides a broad, valid, duplicate-free catalog without embedded credentials', () => {
    expect(walletNetworkPresetsFor('evm').length).toBeGreaterThanOrEqual(30)
    expect(walletNetworkPresetsFor('solana').length).toBeGreaterThanOrEqual(4)
    expect(walletNetworkPresetsFor('tron').length).toBeGreaterThanOrEqual(4)

    const keys = new Set<string>()
    for (const preset of WALLET_NETWORK_PRESETS) {
      expect(keys.has(preset.key)).toBe(false)
      keys.add(preset.key)
      expect(WalletNetworkSchema.safeParse(preset.network).success).toBe(true)
      const url = new URL(preset.network.rpcUrl)
      expect(url.username).toBe('')
      expect(url.password).toBe('')
      expect(url.search).toBe('')
      expect(url.protocol === 'https:' || ['127.0.0.1', 'localhost'].includes(url.hostname)).toBe(true)
    }
  })

  it('includes official public Solana and Tron clusters plus local development', () => {
    expect(walletNetworkPresetsFor('solana').map((preset) => preset.network)).toEqual(expect.arrayContaining([
      { id: 'mainnet', name: 'Solana Mainnet', environment: 'mainnet', rpcUrl: 'https://api.mainnet.solana.com' },
      { id: 'devnet', name: 'Solana Devnet', environment: 'testnet', rpcUrl: 'https://api.devnet.solana.com' },
      { id: 'testnet', name: 'Solana Testnet', environment: 'testnet', rpcUrl: 'https://api.testnet.solana.com' },
      { id: 'localnet', name: 'Solana Local Validator', environment: 'local', rpcUrl: 'http://127.0.0.1:8899' }
    ]))
    expect(walletNetworkPresetsFor('tron').map((preset) => preset.network)).toEqual(expect.arrayContaining([
      { id: 'mainnet', name: 'TRON Mainnet', environment: 'mainnet', rpcUrl: 'https://api.trongrid.io' },
      { id: 'shasta', name: 'TRON Shasta', environment: 'testnet', rpcUrl: 'https://api.shasta.trongrid.io' },
      { id: 'nile', name: 'TRON Nile', environment: 'testnet', rpcUrl: 'https://nile.trongrid.io' },
      { id: 'private', name: 'TRON Private Network', environment: 'local', rpcUrl: 'http://127.0.0.1:8090' }
    ]))
  })
})
