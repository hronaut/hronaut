import { describe, expect, it, vi } from 'vitest'
import {
  generateWalletWithRecoveryConfirmation,
  WALLET_RECOVERY_CANCELLED_MESSAGE
} from '../src/main/wallet/onboarding.js'
import type { WalletDescriptor } from '../src/shared/wallet.js'

const wallet: WalletDescriptor = {
  id: 'wallet-1', name: 'Generated', kind: 'managed', chainFamily: 'evm',
  publicAddress: '0x0000000000000000000000000000000000000001',
  network: { id: '31337', name: 'Anvil', environment: 'local', rpcUrl: 'http://127.0.0.1:8545' },
  capabilities: ['read', 'sign', 'send'], workspaceIds: [], policyIds: [], recoveryConfirmed: false,
  createdAt: '2026-08-29T12:00:00.000Z', updatedAt: '2026-08-29T12:00:00.000Z'
}

function service() {
  return {
    generate: vi.fn(async () => ({ wallet, recoveryMaterial: 'recovery words' })),
    confirmRecovery: vi.fn(async () => ({ ...wallet, recoveryConfirmed: true })),
    remove: vi.fn(async () => true)
  }
}

describe('generated wallet onboarding', () => {
  it('confirms accepted recovery material without discarding the wallet', async () => {
    const walletService = service()

    await expect(generateWalletWithRecoveryConfirmation(
      walletService,
      { name: 'Generated', chainFamily: 'evm', network: wallet.network, workspaceIds: [] },
      async (recoveryMaterial) => recoveryMaterial === 'recovery words'
    )).resolves.toMatchObject({ id: wallet.id, recoveryConfirmed: true })
    expect(walletService.confirmRecovery).toHaveBeenCalledWith(wallet.id)
    expect(walletService.remove).not.toHaveBeenCalled()
  })

  it('removes the unconfirmed wallet when the user declines recovery confirmation', async () => {
    const walletService = service()

    await expect(generateWalletWithRecoveryConfirmation(
      walletService,
      { name: 'Generated', chainFamily: 'evm', network: wallet.network, workspaceIds: [] },
      async () => false
    )).rejects.toThrow(WALLET_RECOVERY_CANCELLED_MESSAGE)
    expect(walletService.confirmRecovery).not.toHaveBeenCalled()
    expect(walletService.remove).toHaveBeenCalledWith(wallet.id)
  })

  it('removes the unconfirmed wallet and sanitizes confirmation failures', async () => {
    const walletService = service()

    await expect(generateWalletWithRecoveryConfirmation(
      walletService,
      { name: 'Generated', chainFamily: 'evm', network: wallet.network, workspaceIds: [] },
      async () => { throw new Error('dialog internals') }
    )).rejects.toThrow('Wallet recovery confirmation failed')
    expect(walletService.remove).toHaveBeenCalledWith(wallet.id)
  })

  it('rolls back when persisting the recovery confirmation fails', async () => {
    const walletService = service()
    walletService.confirmRecovery.mockRejectedValueOnce(new Error('vault path and internals'))

    await expect(generateWalletWithRecoveryConfirmation(
      walletService,
      { name: 'Generated', chainFamily: 'evm', network: wallet.network, workspaceIds: [] },
      async () => true
    )).rejects.toThrow('Wallet recovery confirmation failed')
    expect(walletService.remove).toHaveBeenCalledWith(wallet.id)
  })
})
