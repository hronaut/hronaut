import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import {
  WalletChainFamilySchema, WalletPolicySchema, WalletSecretFormatSchema,
  type WalletCreateInput, type WalletDescriptor, type WalletImportDetails,
  type WalletProviderRequest, type WalletServiceStatus, type WalletUpdateInput,
  type WalletWatchOnlyInput
} from '../../shared/wallet.js'
import type { WalletBroker, WalletBrokerContext } from './broker.js'
import type { WalletService } from './service.js'

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

/** Services are looked up per request; native recovery confirmation stays with the window owner. */
export function registerWalletIpc(ipcMain: Pick<IpcMain, 'handle'>, host: WalletIpcHost): void {
  const requireWalletService = (): WalletIpcService => {
    const service = host.service()
    if (!service) throw new Error('Wallet service is unavailable')
    return service
  }
  const requireWalletBroker = (): WalletIpcBroker => {
    const broker = host.broker()
    if (!broker) throw new Error('Wallet broker is unavailable')
    return broker
  }
  ipcMain.handle('wallet-provider:request', (event, input: WalletProviderRequest) => (
    requireWalletBroker().providerRequest(host.assertWalletPageSender(event), input)
  ))
  ipcMain.handle('wallets:status', (event) => {
    host.assertMainShellSender(event)
    return host.status()
  })
  ipcMain.handle('wallets:list', (event) => {
    host.assertMainShellSender(event)
    return host.service()?.list() ?? []
  })
  ipcMain.handle('wallets:setup-passphrase', async (event, passphrase: unknown) => {
    host.assertMainShellSender(event)
    if (typeof passphrase !== 'string') throw new TypeError('Wallet passphrase must be a string')
    return requireWalletService().setupPassphrase(passphrase)
  })
  ipcMain.handle('wallets:unlock', async (event, passphrase: unknown) => {
    host.assertMainShellSender(event)
    if (typeof passphrase !== 'string') throw new TypeError('Wallet passphrase must be a string')
    return requireWalletService().unlock(passphrase)
  })
  ipcMain.handle('wallets:lock', async (event) => {
    host.assertMainShellSender(event)
    return requireWalletBroker().lock()
  })
  ipcMain.handle('wallets:generate', (event, input: WalletCreateInput) => {
    host.assertMainShellSender(event)
    return host.generateWallet(input)
  })
  ipcMain.handle('wallets:prepare-import', (event, chainFamily: unknown, format: unknown, recoveryMaterial: unknown) => {
    host.assertMainShellSender(event)
    if (typeof recoveryMaterial !== 'string') throw new TypeError('Wallet recovery material must be a string')
    return requireWalletService().prepareImport(
      WalletChainFamilySchema.parse(chainFamily),
      WalletSecretFormatSchema.parse(format),
      recoveryMaterial
    )
  })
  ipcMain.handle('wallets:confirm-import', (event, token: unknown, details: WalletImportDetails) => {
    host.assertMainShellSender(event)
    return requireWalletService().confirmImport(walletIdentifier(token, 'wallet import token'), details)
  })
  ipcMain.handle('wallets:cancel-import', (event, token: unknown) => {
    host.assertMainShellSender(event)
    return requireWalletService().cancelImport(walletIdentifier(token, 'wallet import token'))
  })
  ipcMain.handle('wallets:add-watch-only', (event, input: WalletWatchOnlyInput) => {
    host.assertMainShellSender(event)
    return requireWalletService().addWatchOnly(input)
  })
  ipcMain.handle('wallets:update', (event, walletId: unknown, changes: WalletUpdateInput) => {
    host.assertMainShellSender(event)
    return requireWalletBroker().updateWallet(walletIdentifier(walletId, 'wallet identifier'), changes)
  })
  ipcMain.handle('wallets:remove', (event, walletId: unknown) => {
    host.assertMainShellSender(event)
    return requireWalletBroker().removeWallet(walletIdentifier(walletId, 'wallet identifier'))
  })
  ipcMain.handle('wallets:list-policies', (event, walletId?: unknown) => {
    host.assertMainShellSender(event)
    return host.service()?.policies.list(walletId === undefined ? undefined : walletIdentifier(walletId, 'wallet identifier')) ?? []
  })
  ipcMain.handle('wallets:set-policy', (event, input: unknown) => {
    host.assertMainShellSender(event)
    return requireWalletBroker().setPolicy(WalletPolicySchema.parse(input))
  })
  ipcMain.handle('wallets:remove-policy', (event, policyId: unknown) => {
    host.assertMainShellSender(event)
    return requireWalletBroker().removePolicy(walletIdentifier(policyId, 'wallet policy identifier'))
  })
  ipcMain.handle('wallets:list-permissions', (event) => {
    host.assertMainShellSender(event)
    return host.service()?.permissions.list() ?? []
  })
  ipcMain.handle('wallets:revoke-permission', (event, permissionId: unknown) => {
    host.assertMainShellSender(event)
    return requireWalletBroker().revokePermission(walletIdentifier(permissionId, 'wallet permission identifier'))
  })
  ipcMain.handle('wallets:list-requests', (event) => {
    host.assertMainShellSender(event)
    return host.broker()?.listPending() ?? []
  })
  ipcMain.handle('wallets:approve-request', (event, requestId: unknown) => {
    host.assertMainShellSender(event)
    return requireWalletBroker().approve(walletIdentifier(requestId, 'wallet request identifier'))
  })
  ipcMain.handle('wallets:reject-request', (event, requestId: unknown) => {
    host.assertMainShellSender(event)
    return requireWalletBroker().reject(walletIdentifier(requestId, 'wallet request identifier'))
  })
  ipcMain.handle('wallets:audit-history', (event) => {
    host.assertMainShellSender(event)
    return host.service()?.auditHistory() ?? []
  })
}
