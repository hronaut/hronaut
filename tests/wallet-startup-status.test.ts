import { describe, expect, it } from 'vitest'
import { walletStartingStatus, walletStartupFailureStatus } from '../src/main/wallet/startup-status.js'
import { WALLET_DISABLED_REASONS } from '../src/shared/wallet.js'

describe('walletStartupFailureStatus', () => {
  it.each([
    'Wallet audit history verification failed',
    'Wallet authority authentication failed',
    'Wallet identity authentication failed'
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

  it('reports the shared English reasons Settings names in the interface language', () => {
    expect(walletStartupFailureStatus(new Error('Wallet vault file is invalid')).reason).toBe(WALLET_DISABLED_REASONS.integrityFailure)
    expect(walletStartupFailureStatus(new Error('Wallet vault unlock failed')).reason).toBe(WALLET_DISABLED_REASONS.unlockFailure)
    expect(walletStartupFailureStatus(new Error('disk full')).reason).toBe(WALLET_DISABLED_REASONS.initializationFailure)
    expect(WALLET_DISABLED_REASONS.integrityFailure).toBe('Wallet data failed integrity checks. Wallet operations are disabled.')
  })
})

describe('walletStartingStatus', () => {
  it('says the wallet service has not started yet, in words Settings names in the interface language', () => {
    expect(walletStartingStatus()).toEqual({
      managedWallets: 'disabled',
      backend: 'initializing',
      watchOnlyAvailable: false,
      reason: WALLET_DISABLED_REASONS.notInitialized
    })
  })
})
