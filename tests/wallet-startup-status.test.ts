import { describe, expect, it } from 'vitest'
import { walletStartupFailureStatus } from '../src/main/wallet/startup-status.js'

describe('walletStartupFailureStatus', () => {
  it.each([
    'Wallet audit history verification failed',
    'Wallet authority authentication failed',
    'Wallet identity authentication failed',
    'Wallet legacy policy store is invalid'
  ])('classifies validated persistence failure %s without exposing its input', (message) => {
    expect(walletStartupFailureStatus(new Error(message))).toMatchObject({
      managedWallets: 'disabled',
      backend: 'integrity-failure',
      watchOnlyAvailable: false
    })
  })

  it('distinguishes secure-storage failures from corrupted wallet documents', () => {
    expect(walletStartupFailureStatus(new Error('Wallet vault unlock failed'))).toMatchObject({
      managedWallets: 'disabled',
      backend: 'secure-storage-failure',
      watchOnlyAvailable: false
    })
  })

  it('sanitizes unexpected initialization errors and paths', () => {
    const marker = '/profile/private-wallet-marker'
    const status = walletStartupFailureStatus(new Error(`EACCES: ${marker}`))

    expect(status).toMatchObject({
      managedWallets: 'disabled',
      backend: 'initialization-failure',
      watchOnlyAvailable: false
    })
    expect(JSON.stringify(status)).not.toContain(marker)
  })
})
