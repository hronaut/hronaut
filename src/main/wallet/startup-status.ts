import { WALLET_DISABLED_REASONS, type WalletServiceStatus } from '../../shared/wallet.js'

const INTEGRITY_FAILURES = new Set([
  'Watch-only wallet store is invalid',
  'Wallet permission store is invalid',
  'Wallet policy store is invalid',
  'Wallet policy usage store is invalid',
  'Wallet approval store is invalid',
  'Wallet audit history verification failed',
  'Wallet vault file is invalid',
  'Wallet vault protection mode mismatch',
  'Wallet vault authentication failed',
  'Wallet authority authentication failed',
  'Wallet identity authentication failed'
])

/**
 * The status while the wallet service starts, which waits for the operating system's secure storage; the shell starts
 * with the same backend name.
 */
export function walletStartingStatus(): WalletServiceStatus {
  return {
    managedWallets: 'disabled',
    backend: 'initializing',
    watchOnlyAvailable: false,
    reason: WALLET_DISABLED_REASONS.notInitialized
  }
}

export function walletStartupFailureStatus(error: unknown): WalletServiceStatus {
  const message = error instanceof Error ? error.message : ''
  if (INTEGRITY_FAILURES.has(message)) {
    return {
      managedWallets: 'disabled',
      backend: 'integrity-failure',
      watchOnlyAvailable: false,
      reason: WALLET_DISABLED_REASONS.integrityFailure
    }
  }
  if (message === 'Wallet vault unlock failed') {
    return {
      managedWallets: 'disabled',
      backend: 'secure-storage-failure',
      watchOnlyAvailable: false,
      reason: WALLET_DISABLED_REASONS.unlockFailure
    }
  }
  return {
    managedWallets: 'disabled',
    backend: 'initialization-failure',
    watchOnlyAvailable: false,
    reason: WALLET_DISABLED_REASONS.initializationFailure
  }
}
