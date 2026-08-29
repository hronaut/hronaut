import type { WalletCreateInput, WalletDescriptor } from '../../shared/wallet.js'
import type { WalletGeneratedResult } from './service.js'

interface WalletOnboardingService {
  generate(input: WalletCreateInput): Promise<WalletGeneratedResult>
  confirmRecovery(walletId: string): Promise<WalletDescriptor>
  remove(walletId: string): Promise<boolean>
}

export const WALLET_RECOVERY_CANCELLED_MESSAGE = 'Wallet creation cancelled before recovery confirmation'
const WALLET_RECOVERY_FAILED_MESSAGE = 'Wallet recovery confirmation failed'
const WALLET_RECOVERY_ROLLBACK_FAILED_MESSAGE = 'Wallet recovery confirmation failed and the unconfirmed wallet could not be removed'

async function discardUnconfirmedWallet(service: WalletOnboardingService, walletId: string): Promise<void> {
  try {
    if (await service.remove(walletId)) return
  } catch {
    // Replace storage errors with a stable non-secret message below.
  }
  throw new Error(WALLET_RECOVERY_ROLLBACK_FAILED_MESSAGE)
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
    throw new Error(WALLET_RECOVERY_FAILED_MESSAGE)
  }

  if (!accepted) {
    await discardUnconfirmedWallet(service, generated.wallet.id)
    throw new Error(WALLET_RECOVERY_CANCELLED_MESSAGE)
  }

  try {
    return await service.confirmRecovery(generated.wallet.id)
  } catch {
    await discardUnconfirmedWallet(service, generated.wallet.id)
    throw new Error(WALLET_RECOVERY_FAILED_MESSAGE)
  }
}
