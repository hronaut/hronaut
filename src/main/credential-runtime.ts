import { app, safeStorage, type BrowserWindow } from 'electron'
import { join } from 'node:path'
import { CredentialStore } from './credential-store.js'
import { encryptsWithKeyringKey } from './keyring-key.js'
import { createSuggestedPasswordMemory } from './browser/suggested-password/suggested-password-memory.js'
import type { BrowserCredentialCandidate } from './browser/tabs-manager.js'
import type { TrustedDialogOptions } from './trusted-dialogs/trusted-dialogs.js'
import type { MessageKey, MessageParameters } from '../shared/i18n.js'
import type { CredentialStorageStatus } from '../shared/types.js'

/**
 * Saved passwords' storage, created once by index.ts. Startup opens the store when secure storage allows it; the
 * license runtime, the credentials IPC, browsing data, the panel snapshot and shutdown read the fields when they
 * run, so they always see what startup found.
 */
export interface CredentialRuntimeState {
  /** Whether secure storage is available, and why not; unavailable while initializing, until startup checks it. */
  storageStatus: CredentialStorageStatus
  /** The encrypted password store, once open. */
  store: CredentialStore | null
}

interface CredentialRuntimeHost {
  /** Translates into the current interface language; read on every use because the language can change. */
  text(key: MessageKey, parameters?: MessageParameters): string
  /** Asks in Hronaut's own dialog over the main window's pages, or in the system dialog while that window cannot show it. */
  showDialog(options: Omit<TrustedDialogOptions, 'window'>): Promise<{ response: number }>
  /** The main window, without which no password is offered for saving; read on every use because it can close. */
  mainWindow(): Pick<BrowserWindow, 'isDestroyed'> | null
  /** Secure storage's status and the password store; index.ts creates the record, and other features read it too. */
  state: CredentialRuntimeState
  sendToShellWindows(channel: string, ...args: unknown[]): void
  /** Tells the shell that a browser action failed, such as saving a password a page submitted. */
  reportBrowserActionFailure(action: string, error: unknown): void
}

/**
 * Integration tests hold the operating system's secure storage, as a keyring waiting for the person to unlock it does,
 * until they release it through `__hronautReleaseSecureStorageForTest`.
 */
function secureStorageHeldForTest(): Promise<void> {
  if (process.env.HRONAUT_INTEGRATION_TEST_HOOKS !== '1' || process.env.HRONAUT_TEST_HOLD_SECURE_STORAGE !== '1') return Promise.resolve()
  return new Promise((resolve) => {
    ;(globalThis as typeof globalThis & { __hronautReleaseSecureStorageForTest?: () => void }).__hronautReleaseSecureStorageForTest = resolve
  })
}

/**
 * Saved passwords on this device: opening the store encrypted with the operating system's secure storage, which
 * stays closed when only Linux's plain-text backend is available, offering to save or update a password a page
 * submitted, saying so when Hronaut suggested that password, and telling both shell windows which passwords are saved.
 */
export function createCredentialRuntime(host: CredentialRuntimeHost): {
  publishCredentials(): void
  offerToSaveCredential(candidate: BrowserCredentialCandidate): void
  /** Hronaut suggested this password for the website; the offer to save it then says that nothing else shows it. */
  rememberSuggestedPassword(origin: string, password: string): void
  configureCredentialStore(): Promise<void>
} {
  const suggestedPasswords = createSuggestedPasswordMemory()

  /** Tells both shell windows which passwords are saved. */
  function publishCredentials(): void {
    host.sendToShellWindows('credentials:changed', host.state.store?.list() ?? [])
  }

  /**
   * The saved account a form that changes a password names none for, as Chrome finds it: the website's only saved
   * account, or else the one whose saved password is the current password the form gave. Without one, or with several
   * that have it, which Hronaut has no way to choose between, the password is offered for an unnamed account. Saved
   * passwords are compared here and never leave the main process.
   */
  async function changedAccount(origin: string, previousPassword: string | undefined): Promise<string> {
    if (!previousPassword || previousPassword.length > 16_384) return ''
    const saved = host.state.store!.list().filter((entry) => entry.origin === origin)
    if (saved.length === 1) return saved[0]!.username
    const matches: string[] = []
    for (const entry of saved) {
      // A password the secure storage cannot decrypt is not this one.
      if (await host.state.store!.password(entry.id).catch(() => null) === previousPassword) matches.push(entry.username)
    }
    return matches.length === 1 ? matches[0]! : ''
  }

  async function handleCredentialCandidate(candidate: BrowserCredentialCandidate): Promise<void> {
    if (!host.state.storageStatus.available || !host.state.store || !host.mainWindow() || host.mainWindow()!.isDestroyed()) return
    if (candidate.username.length > 512 || !candidate.password || candidate.password.length > 16_384) return
    try {
      if (new URL(candidate.origin).origin !== candidate.origin) return
    } catch {
      return
    }
    const username = candidate.username || await changedAccount(candidate.origin, candidate.previousPassword)
    const updating = host.state.store!.has(candidate.origin, username)
    const suggested = suggestedPasswords.suggested(candidate.origin, candidate.password)
    const account = username || host.text('native.dialog.unnamedAccount')
    const detail = host.text('native.dialog.passwordDetail', { origin: candidate.origin })
    const { response } = await host.showDialog({
      type: 'question',
      title: host.text(updating ? 'native.dialog.updatePasswordTitle' : 'native.dialog.savePasswordTitle'),
      message: host.text(updating ? 'native.dialog.updatePasswordMessage' : 'native.dialog.savePasswordMessage', { account }),
      detail: suggested ? `${detail}\n\n${host.text('native.dialog.suggestedPasswordWarning')}` : detail,
      buttons: [host.text('native.dialog.notNow'), host.text(updating ? 'native.dialog.updatePassword' : 'native.dialog.savePassword')],
      defaultId: 1,
      cancelId: 0,
      primaryId: 1,
      noLink: true,
      variant: { kind: 'save-password', origin: candidate.origin, username, updating, suggested }
    })
    if (response !== 1) return
    await host.state.store!.save(candidate.origin, username, candidate.password)
    publishCredentials()
  }

  /** Offers to save a password a page submitted; a failure is logged and reported to the shell. */
  function offerToSaveCredential(candidate: BrowserCredentialCandidate): void {
    void handleCredentialCandidate(candidate).catch((error) => {
      console.error('[credentials] Failed to save password:', error)
      host.reportBrowserActionFailure('save password', error)
    })
  }

  /**
   * Opens the password store once the operating system's secure storage answers, and tells both shell windows its
   * status and the saved passwords. The storage can take as long as the person takes to unlock it, as a keyring that
   * stayed locked at sign-in asks to, so startup does not wait for this. It never fails: a store that cannot open
   * leaves saved passwords unavailable, saying why.
   */
  async function configureCredentialStore(): Promise<void> {
    const backend = process.platform === 'linux' ? safeStorage.getSelectedStorageBackend() : process.platform === 'darwin' ? 'macOS Keychain' : 'Windows DPAPI'
    try {
      await secureStorageHeldForTest()
      const available = await safeStorage.isAsyncEncryptionAvailable()
      // Linux's fallback key is no more secret than plain text, and cannot read what a keyring's key encrypted.
      if (!available || backend === 'basic_text' || !await encryptsWithKeyringKey(safeStorage)) {
        host.state.storageStatus = {
          available: false,
          backend,
          reason: available || backend === 'basic_text'
            ? host.text('native.errors.linuxSecrets')
            : host.text('native.errors.secureStorage')
        }
      } else {
        const store = new CredentialStore(join(app.getPath('userData'), 'credentials.json'), {
          encrypt: (value) => safeStorage.encryptStringAsync(value),
          decrypt: (value) => safeStorage.decryptStringAsync(value)
        })
        await store.load()
        host.state.store = store
        host.state.storageStatus = { available: true, backend }
      }
    } catch (error) {
      console.error('[credentials] Could not open saved passwords:', error)
      host.state.store = null
      host.state.storageStatus = { available: false, backend, reason: host.text('native.errors.secureStorage') }
    }
    host.sendToShellWindows('credentials:status-changed', host.state.storageStatus)
    publishCredentials()
  }

  return {
    publishCredentials,
    offerToSaveCredential,
    rememberSuggestedPassword: (origin, password) => suggestedPasswords.remember(origin, password),
    configureCredentialStore
  }
}
