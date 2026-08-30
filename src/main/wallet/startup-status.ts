import type { WalletServiceStatus } from '../../shared/wallet.js'

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
  'Wallet identity authentication failed',
  'Wallet legacy policy store is invalid'
])

export function walletStartupFailureStatus(error: unknown): WalletServiceStatus {
  const message = error instanceof Error ? error.message : ''
  if (INTEGRITY_FAILURES.has(message)) {
    return {
      managedWallets: 'disabled',
      backend: 'integrity-failure',
      watchOnlyAvailable: false,
      reason: 'Wallet data failed integrity checks. Wallet operations are disabled.'
    }
  }
  if (message === 'Wallet vault unlock failed') {
    return {
      managedWallets: 'disabled',
      backend: 'secure-storage-failure',
      watchOnlyAvailable: false,
      reason: 'The wallet vault could not be unlocked with operating-system secure storage. Wallet operations are disabled.'
    }
  }
  return {
    managedWallets: 'disabled',
    backend: 'initialization-failure',
    watchOnlyAvailable: false,
    reason: 'Wallet initialization failed. Wallet operations are disabled.'
  }
}
