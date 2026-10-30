import type { CredentialImportResult, CredentialStorageStatus, CredentialSummary } from '../types.js'
import type { EventChannel, InvokeChannel } from './channel.js'

/** Saved passwords, for Settings' password manager. Passwords themselves never cross these channels. */
export const CREDENTIALS_IPC = {
  /** Shell → main: whether secure storage can keep passwords, and why not. */
  status: 'credentials:status' as InvokeChannel<[], CredentialStorageStatus>,
  /** Shell → main: the saved passwords' sites and usernames. */
  list: 'credentials:list' as InvokeChannel<[], CredentialSummary[]>,
  /** Shell → main: imports a CSV file of passwords the person picks. */
  importCsv: 'credentials:import-csv' as InvokeChannel<[], CredentialImportResult>,
  /** Shell → main: fills a saved password into the tab's sign-in form; false when it could not. */
  fill: 'credentials:fill' as InvokeChannel<[tabId: string, credentialId: string], boolean>,
  /** Shell → main: forgets a saved password; false when there was none. */
  remove: 'credentials:remove' as InvokeChannel<[id: string], boolean>,
  /** Shell → main: forgets every saved password. */
  clear: 'credentials:clear' as InvokeChannel<[], void>,
  /** Main → shells: the saved passwords changed. */
  changed: 'credentials:changed' as EventChannel<[credentials: CredentialSummary[]]>,
  /** Main → shells: secure storage answered after startup, as once a locked keyring is unlocked. */
  statusChanged: 'credentials:status-changed' as EventChannel<[status: CredentialStorageStatus]>
}
