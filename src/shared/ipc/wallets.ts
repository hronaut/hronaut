import type { WalletAuditSummary, WalletPermissionSummary, WalletPreparedImport } from '../types.js'
import type {
  WalletCreateInput,
  WalletDescriptor,
  WalletImportDetails,
  WalletPolicy,
  WalletRequestSummary,
  WalletSecretFormat,
  WalletServiceStatus,
  WalletUpdateInput,
  WalletWatchOnlyInput
} from '../wallet.js'
import type { EventChannel, InvokeChannel } from './channel.js'

/**
 * The agent wallets, for the main window only: main refuses every other sender. Main answers without wallet secrets;
 * a recovery phrase is shown only in the trusted overlay.
 */
export const WALLETS_IPC = {
  /** Main window → main: whether managed wallets are ready, locked, need a passphrase or are off, and why. */
  status: 'wallets:status' as InvokeChannel<[], WalletServiceStatus>,
  /** Main window → main: every wallet. */
  list: 'wallets:list' as InvokeChannel<[], WalletDescriptor[]>,
  /** Main window → main: sets up the vault with the person's passphrase, answering with the status after. */
  setupPassphrase: 'wallets:setup-passphrase' as InvokeChannel<[passphrase: string], WalletServiceStatus>,
  /** Main window → main: unlocks the vault with the person's passphrase, answering with the status after. */
  unlock: 'wallets:unlock' as InvokeChannel<[passphrase: string], WalletServiceStatus>,
  /** Main window → main: locks the vault, answering with the status after. */
  lock: 'wallets:lock' as InvokeChannel<[], WalletServiceStatus>,
  /**
   * Main window → main: creates a wallet with a new key, answering once the person confirms in the trusted overlay that
   * they saved its recovery phrase; otherwise the wallet is discarded and the call fails.
   */
  generate: 'wallets:generate' as InvokeChannel<[input: WalletCreateInput], WalletDescriptor>,
  /** Main window → main: checks recovery material for an import, answering with the address it adds and a token. */
  prepareImport: 'wallets:prepare-import' as InvokeChannel<
    [chainFamily: WalletDescriptor['chainFamily'], format: WalletSecretFormat, recoveryMaterial: string],
    WalletPreparedImport
  >,
  /** Main window → main: adds the wallet a prepared import's token names. */
  confirmImport: 'wallets:confirm-import' as InvokeChannel<[token: string, details: WalletImportDetails], WalletDescriptor>,
  /** Main window → main: forgets a prepared import, answering whether there was one. */
  cancelImport: 'wallets:cancel-import' as InvokeChannel<[token: string], boolean>,
  /** Main window → main: adds a wallet that only watches an address. */
  addWatchOnly: 'wallets:add-watch-only' as InvokeChannel<[input: WalletWatchOnlyInput], WalletDescriptor>,
  /** Main window → main: changes a wallet's name or settings. */
  update: 'wallets:update' as InvokeChannel<[walletId: string, changes: WalletUpdateInput], WalletDescriptor>,
  /** Main window → main: removes a wallet, answering whether it did. */
  remove: 'wallets:remove' as InvokeChannel<[walletId: string], boolean>,
  /** Main window → main: the signing policies, of one wallet or of all. */
  listPolicies: 'wallets:list-policies' as InvokeChannel<[walletId?: string], WalletPolicy[]>,
  /** Main window → main: saves a signing policy. */
  setPolicy: 'wallets:set-policy' as InvokeChannel<[policy: WalletPolicy], WalletPolicy>,
  /** Main window → main: removes a signing policy, answering whether there was one. */
  removePolicy: 'wallets:remove-policy' as InvokeChannel<[policyId: string], boolean>,
  /** Main window → main: the websites allowed to use a wallet. */
  listPermissions: 'wallets:list-permissions' as InvokeChannel<[], WalletPermissionSummary[]>,
  /** Main window → main: takes a website's access to a wallet back, answering whether it did. */
  revokePermission: 'wallets:revoke-permission' as InvokeChannel<[permissionId: string], boolean>,
  /** Main window → main: the requests waiting for the person's approval. */
  listRequests: 'wallets:list-requests' as InvokeChannel<[], WalletRequestSummary[]>,
  /** Main window → main: approves a waiting request. */
  approveRequest: 'wallets:approve-request' as InvokeChannel<[requestId: string], WalletRequestSummary>,
  /** Main window → main: rejects a waiting request. */
  rejectRequest: 'wallets:reject-request' as InvokeChannel<[requestId: string], WalletRequestSummary>,
  /** Main window → main: the wallets' audit log. */
  auditHistory: 'wallets:audit-history' as InvokeChannel<[], WalletAuditSummary[]>,
  /** Main → main window: the wallets changed. */
  changed: 'wallets:changed' as EventChannel<[wallets: WalletDescriptor[]]>,
  /** Main → main window: the vault's status changed. */
  statusChanged: 'wallets:status-changed' as EventChannel<[status: WalletServiceStatus]>,
  /** Main → main window: the requests waiting for approval changed. */
  requestsChanged: 'wallets:requests-changed' as EventChannel<[requests: WalletRequestSummary[]]>
} as const
