import type { HronautWalletsApi } from '../../shared/types.js'
import type {
  WalletCreateInput,
  WalletDescriptor,
  WalletImportDetails,
  WalletPolicy,
  WalletSecretFormat,
  WalletUpdateInput,
  WalletWatchOnlyInput
} from '../../shared/wallet.js'
import { WALLETS_IPC } from '../../shared/ipc/wallets.js'
import { invoke, subscribe } from './ipc.js'

/** window.hronautWallets: the agent wallets, which main answers for the main window only. */
export const walletsApi: HronautWalletsApi = {
  status: () => invoke(WALLETS_IPC.status),
  list: () => invoke(WALLETS_IPC.list),
  setupPassphrase: (passphrase: string) => invoke(WALLETS_IPC.setupPassphrase, passphrase),
  unlock: (passphrase: string) => invoke(WALLETS_IPC.unlock, passphrase),
  lock: () => invoke(WALLETS_IPC.lock),
  generate: (input: WalletCreateInput) => invoke(WALLETS_IPC.generate, input),
  prepareImport: (chainFamily: WalletDescriptor['chainFamily'], format: WalletSecretFormat, recoveryMaterial: string) =>
    invoke(WALLETS_IPC.prepareImport, chainFamily, format, recoveryMaterial),
  confirmImport: (token: string, details: WalletImportDetails) => invoke(WALLETS_IPC.confirmImport, token, details),
  cancelImport: (token: string) => invoke(WALLETS_IPC.cancelImport, token),
  addWatchOnly: (input: WalletWatchOnlyInput) => invoke(WALLETS_IPC.addWatchOnly, input),
  update: (walletId: string, changes: WalletUpdateInput) => invoke(WALLETS_IPC.update, walletId, changes),
  remove: (walletId: string) => invoke(WALLETS_IPC.remove, walletId),
  listPolicies: (walletId?: string) => invoke(WALLETS_IPC.listPolicies, walletId),
  setPolicy: (policy: WalletPolicy) => invoke(WALLETS_IPC.setPolicy, policy),
  removePolicy: (policyId: string) => invoke(WALLETS_IPC.removePolicy, policyId),
  listPermissions: () => invoke(WALLETS_IPC.listPermissions),
  revokePermission: (permissionId: string) => invoke(WALLETS_IPC.revokePermission, permissionId),
  listRequests: () => invoke(WALLETS_IPC.listRequests),
  approveRequest: (requestId: string) => invoke(WALLETS_IPC.approveRequest, requestId),
  rejectRequest: (requestId: string) => invoke(WALLETS_IPC.rejectRequest, requestId),
  auditHistory: () => invoke(WALLETS_IPC.auditHistory),
  onChanged: (listener) => subscribe(WALLETS_IPC.changed, (wallets) => listener(wallets)),
  onStatusChanged: (listener) => subscribe(WALLETS_IPC.statusChanged, (status) => listener(status)),
  onRequestsChanged: (listener) => subscribe(WALLETS_IPC.requestsChanged, (requests) => listener(requests))
}
