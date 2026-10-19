import type { WalletCreateInput, WalletDescriptor } from '../../shared/wallet.js'
import type { WalletGeneratedResult } from './service.js'
import { LocalizedError } from '../localized-error.js'

interface WalletOnboardingService {
  generate(input: WalletCreateInput): Promise<WalletGeneratedResult>
  confirmRecovery(walletId: string): Promise<WalletDescriptor>
  remove(walletId: string): Promise<boolean>
}

/** The English message, which logs keep, when the person did not confirm that they saved the recovery phrase. */
export const WALLET_RECOVERY_CANCELLED_MESSAGE = 'Wallet creation cancelled before recovery confirmation'

async function discardUnconfirmedWallet(service: WalletOnboardingService, walletId: string): Promise<void> {
  try {
    if (await service.remove(walletId)) return
  } catch {
    // Replace storage errors with a stable non-secret message below.
  }
  throw new LocalizedError('appErrors.wallet.recoveryRollbackFailed')
}

export async function generateWalletWithRecoveryConfirmation(
  service: WalletOnboardingService,
  input: WalletCreateInput,
  requestConfirmation: (recoveryMaterial: string) => Promise<boolean>
): Promise<WalletDescriptor> {
  const generated = await service.generate(input)
  let accepted: boolean
  try {
    accepted = await requestConfirmation(generated.recoveryMaterial)
  } catch {
    await discardUnconfirmedWallet(service, generated.wallet.id)
    throw new LocalizedError('appErrors.wallet.recoveryFailed')
  }

  if (!accepted) {
    await discardUnconfirmedWallet(service, generated.wallet.id)
    throw new LocalizedError('appErrors.wallet.recoveryCancelled')
  }

  try {
    return await service.confirmRecovery(generated.wallet.id)
  } catch {
    await discardUnconfirmedWallet(service, generated.wallet.id)
    throw new LocalizedError('appErrors.wallet.recoveryFailed')
  }
}
