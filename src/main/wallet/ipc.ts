import type { IpcMainInvokeEvent } from 'electron'
import type { TypedIpcMain } from '../typed-ipc.js'
import {
  WalletChainFamilySchema, WalletCreateInputSchema, WalletImportDetailsSchema, WalletPolicySchema,
  WalletSecretFormatSchema, WalletUpdateInputSchema, WalletWatchOnlyInputSchema,
  type WalletCreateInput, type WalletDescriptor, type WalletProviderRequest, type WalletServiceStatus
} from '../../shared/wallet.js'
import type { WalletBroker, WalletBrokerContext } from './broker.js'
import type { WalletService } from './service.js'
import { LocalizedError } from '../localized-error.js'
import { WALLETS_IPC } from '../../shared/ipc/wallets.js'
import { WALLET_PROVIDER_IPC } from '../../shared/ipc/wallet-provider.js'

type WalletIpcService = Pick<WalletService,
  'list' | 'setupPassphrase' | 'unlock' | 'prepareImport' | 'confirmImport' |
  'cancelImport' | 'addWatchOnly' | 'auditHistory'
> & {
  policies: Pick<WalletService['policies'], 'list'>
  permissions: Pick<WalletService['permissions'], 'list'>
}
type WalletIpcBroker = Pick<WalletBroker,
  'providerRequest' | 'lock' | 'updateWallet' | 'removeWallet' | 'setPolicy' |
  'removePolicy' | 'revokePermission' | 'listPending' | 'approve' | 'reject'
>

interface WalletIpcHost {
  assertMainShellSender(event: IpcMainInvokeEvent): void
  assertWalletPageSender(event: IpcMainInvokeEvent): WalletBrokerContext
  service(): WalletIpcService | null
  broker(): WalletIpcBroker | null
  status(): WalletServiceStatus
  generateWallet(input: WalletCreateInput): Promise<WalletDescriptor>
}

function walletIdentifier(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() !== value || value.length < 1 || value.length > 128) {
    throw new TypeError(`Invalid ${label}`)
  }
  return value
}

/** Services are looked up per request; the recovery confirmation stays with the main window. */
export function registerWalletIpc(ipcMain: Pick<TypedIpcMain, 'handle'>, host: WalletIpcHost): void {
  const requireWalletService = (): WalletIpcService => {
    const service = host.service()
    if (!service) throw new LocalizedError('appErrors.wallet.serviceUnavailable')
    return service
  }
  const requireWalletBroker = (): WalletIpcBroker => {
    const broker = host.broker()
    // The broker exists whenever the service does, so a person reads that the wallet service is unavailable.
    if (!broker) throw new LocalizedError('appErrors.wallet.serviceUnavailable', undefined, { message: 'Wallet broker is unavailable' })
    return broker
  }
  // The broker parses the request itself, so a website's malformed one gets the broker's sanitized error.
  ipcMain.handle(WALLET_PROVIDER_IPC.request, (event, input: unknown) => (
    requireWalletBroker().providerRequest(host.assertWalletPageSender(event), input as WalletProviderRequest)
  ))
  ipcMain.handle(WALLETS_IPC.status, (event) => {
    host.assertMainShellSender(event)
    return host.status()
  })
  ipcMain.handle(WALLETS_IPC.list, (event) => {
    host.assertMainShellSender(event)
    return host.service()?.list() ?? []
  })
  ipcMain.handle(WALLETS_IPC.setupPassphrase, async (event, passphrase: unknown) => {
    host.assertMainShellSender(event)
    if (typeof passphrase !== 'string') throw new TypeError('Wallet passphrase must be a string')
    return requireWalletService().setupPassphrase(passphrase)
  })
  ipcMain.handle(WALLETS_IPC.unlock, async (event, passphrase: unknown) => {
    host.assertMainShellSender(event)
    if (typeof passphrase !== 'string') throw new TypeError('Wallet passphrase must be a string')
    return requireWalletService().unlock(passphrase)
  })
  ipcMain.handle(WALLETS_IPC.lock, async (event) => {
    host.assertMainShellSender(event)
    return requireWalletBroker().lock()
  })
  ipcMain.handle(WALLETS_IPC.generate, (event, input: unknown) => {
    host.assertMainShellSender(event)
    return host.generateWallet(WalletCreateInputSchema.parse(input))
  })
  ipcMain.handle(WALLETS_IPC.prepareImport, (event, chainFamily: unknown, format: unknown, recoveryMaterial: unknown) => {
    host.assertMainShellSender(event)
    if (typeof recoveryMaterial !== 'string') throw new TypeError('Wallet recovery material must be a string')
    return requireWalletService().prepareImport(
      WalletChainFamilySchema.parse(chainFamily),
      WalletSecretFormatSchema.parse(format),
      recoveryMaterial
    )
  })
  ipcMain.handle(WALLETS_IPC.confirmImport, (event, token: unknown, details: unknown) => {
    host.assertMainShellSender(event)
    return requireWalletService().confirmImport(walletIdentifier(token, 'wallet import token'), WalletImportDetailsSchema.parse(details))
  })
  ipcMain.handle(WALLETS_IPC.cancelImport, (event, token: unknown) => {
    host.assertMainShellSender(event)
    return requireWalletService().cancelImport(walletIdentifier(token, 'wallet import token'))
  })
  ipcMain.handle(WALLETS_IPC.addWatchOnly, (event, input: unknown) => {
    host.assertMainShellSender(event)
    return requireWalletService().addWatchOnly(WalletWatchOnlyInputSchema.parse(input))
  })
  ipcMain.handle(WALLETS_IPC.update, (event, walletId: unknown, changes: unknown) => {
    host.assertMainShellSender(event)
    return requireWalletBroker().updateWallet(walletIdentifier(walletId, 'wallet identifier'), WalletUpdateInputSchema.parse(changes))
  })
  ipcMain.handle(WALLETS_IPC.remove, (event, walletId: unknown) => {
    host.assertMainShellSender(event)
    return requireWalletBroker().removeWallet(walletIdentifier(walletId, 'wallet identifier'))
  })
  ipcMain.handle(WALLETS_IPC.listPolicies, (event, walletId?: unknown) => {
    host.assertMainShellSender(event)
    return host.service()?.policies.list(walletId === undefined ? undefined : walletIdentifier(walletId, 'wallet identifier')) ?? []
  })
  ipcMain.handle(WALLETS_IPC.setPolicy, (event, input: unknown) => {
    host.assertMainShellSender(event)
    return requireWalletBroker().setPolicy(WalletPolicySchema.parse(input))
  })
  ipcMain.handle(WALLETS_IPC.removePolicy, (event, policyId: unknown) => {
    host.assertMainShellSender(event)
    return requireWalletBroker().removePolicy(walletIdentifier(policyId, 'wallet policy identifier'))
  })
  ipcMain.handle(WALLETS_IPC.listPermissions, (event) => {
    host.assertMainShellSender(event)
    return host.service()?.permissions.list() ?? []
  })
  ipcMain.handle(WALLETS_IPC.revokePermission, (event, permissionId: unknown) => {
    host.assertMainShellSender(event)
    return requireWalletBroker().revokePermission(walletIdentifier(permissionId, 'wallet permission identifier'))
  })
  ipcMain.handle(WALLETS_IPC.listRequests, (event) => {
    host.assertMainShellSender(event)
    return host.broker()?.listPending() ?? []
  })
  ipcMain.handle(WALLETS_IPC.approveRequest, (event, requestId: unknown) => {
    host.assertMainShellSender(event)
    return requireWalletBroker().approve(walletIdentifier(requestId, 'wallet request identifier'))
  })
  ipcMain.handle(WALLETS_IPC.rejectRequest, (event, requestId: unknown) => {
    host.assertMainShellSender(event)
    return requireWalletBroker().reject(walletIdentifier(requestId, 'wallet request identifier'))
  })
  ipcMain.handle(WALLETS_IPC.auditHistory, (event) => {
    host.assertMainShellSender(event)
    return host.service()?.auditHistory() ?? []
  })
}
