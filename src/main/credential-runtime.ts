import { app, safeStorage, type BrowserWindow, type MessageBoxOptions, type MessageBoxReturnValue } from 'electron'
import { join } from 'node:path'
import { CredentialStore } from './credential-store.js'
import type { BrowserCredentialCandidate } from './browser/tabs-manager.js'
import type { MessageKey, MessageParameters } from '../shared/i18n.js'
import type { CredentialStorageStatus } from '../shared/types.js'

interface CredentialRuntimeHost {
  /** Translates into the current interface language; read on every use because the language can change. */
  text(key: MessageKey, parameters?: MessageParameters): string
  /** Asks on the main window, or on its own while there is none. */
  showMessageBox(options: MessageBoxOptions): Promise<MessageBoxReturnValue>
  /** The main window, without which no password is offered for saving; read on every use because it can close. */
  mainWindow(): Pick<BrowserWindow, 'isDestroyed'> | null
  /** Whether secure storage is available, and why not; the license runtime, the credentials IPC and startup read it too. */
  credentialStorageStatus(): CredentialStorageStatus
  setCredentialStorageStatus(status: CredentialStorageStatus): void
  /** The encrypted password store, once open; the credentials IPC, browsing data, snapshots and shutdown read it too. */
  credentialStore(): CredentialStore | null
  setCredentialStore(store: CredentialStore): void
  publishCredentials(): void
}

/**
 * Saved passwords on this device: opening the store encrypted with the operating system's secure storage, which
 * stays closed when only Linux's plain-text backend is available, and offering to save or update a password a page
 * submitted.
 */
export function createCredentialRuntime(host: CredentialRuntimeHost): {
  handleCredentialCandidate(candidate: BrowserCredentialCandidate): Promise<void>
  configureCredentialStore(): Promise<void>
} {
  async function handleCredentialCandidate(candidate: BrowserCredentialCandidate): Promise<void> {
    if (!host.credentialStorageStatus().available || !host.credentialStore() || !host.mainWindow() || host.mainWindow()!.isDestroyed()) return
    if (candidate.username.length > 512 || !candidate.password || candidate.password.length > 16_384) return
    try {
      if (new URL(candidate.origin).origin !== candidate.origin) return
    } catch {
      return
    }
    const updating = host.credentialStore()!.has(candidate.origin, candidate.username)
    const account = candidate.username || host.text('native.dialog.unnamedAccount')
    const { response } = await host.showMessageBox({
      type: 'question',
      title: host.text(updating ? 'native.dialog.updatePasswordTitle' : 'native.dialog.savePasswordTitle'),
      message: host.text(updating ? 'native.dialog.updatePasswordMessage' : 'native.dialog.savePasswordMessage', { account }),
      detail: host.text('native.dialog.passwordDetail', { origin: candidate.origin }),
      buttons: [host.text('native.dialog.notNow'), host.text(updating ? 'native.dialog.updatePassword' : 'native.dialog.savePassword')],
      defaultId: 1,
      cancelId: 0,
      noLink: true
    })
    if (response !== 1) return
    await host.credentialStore()!.save(candidate.origin, candidate.username, candidate.password)
    host.publishCredentials()
  }

  async function configureCredentialStore(): Promise<void> {
    const available = await safeStorage.isAsyncEncryptionAvailable()
    const backend = process.platform === 'linux' ? safeStorage.getSelectedStorageBackend() : process.platform === 'darwin' ? 'macOS Keychain' : 'Windows DPAPI'
    if (!available || backend === 'basic_text') {
      host.setCredentialStorageStatus({
        available: false,
        backend,
        reason: backend === 'basic_text'
          ? host.text('native.errors.linuxSecrets')
          : host.text('native.errors.secureStorage')
      })
      return
    }
    host.setCredentialStorageStatus({ available: true, backend })
    host.setCredentialStore(new CredentialStore(join(app.getPath('userData'), 'credentials.json'), {
      encrypt: (value) => safeStorage.encryptStringAsync(value),
      decrypt: (value) => safeStorage.decryptStringAsync(value)
    }))
    await host.credentialStore()!.load()
  }

  return { handleCredentialCandidate, configureCredentialStore }
}
