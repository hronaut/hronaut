import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const electron = vi.hoisted(() => ({
  profile: '',
  backend: 'gnome_libsecret',
  /** Which key encrypts: a keyring's ("v11"), or Linux's fallback key ("v10") when no keyring answered. */
  key: 'v11',
  answer: Promise.resolve(true) as Promise<boolean>
}))
vi.mock('electron', () => ({
  app: { getPath: () => electron.profile },
  safeStorage: {
    isAsyncEncryptionAvailable: () => electron.answer,
    getSelectedStorageBackend: () => electron.backend,
    encryptStringAsync: async (value: string) => Buffer.from(`${electron.key}${value}`),
    decryptStringAsync: async (value: Buffer) => ({ result: value.toString().slice(3), shouldReEncrypt: false })
  }
}))

const { createCredentialRuntime } = await import('../src/main/credentials/credential-runtime.js')
const { translate } = await import('../src/shared/i18n.js')

function runtime() {
  const state = { storageStatus: { available: false, reason: 'Secure storage is initializing.' }, store: null } as Parameters<typeof createCredentialRuntime>[0]['state']
  const sendToShellWindows = vi.fn()
  const credentials = createCredentialRuntime({
    text: (key, parameters) => translate('en-US', key, parameters),
    showDialog: vi.fn(),
    mainWindow: () => null,
    state,
    sendToShellWindows,
    reportBrowserActionFailure: vi.fn()
  })
  return { credentials, state, sendToShellWindows }
}

beforeEach(async () => {
  electron.profile = await mkdtemp(join(tmpdir(), 'hronaut-credential-startup-'))
  electron.backend = 'gnome_libsecret'
  electron.key = 'v11'
  electron.answer = Promise.resolve(true)
})

afterEach(async () => {
  vi.restoreAllMocks()
  await rm(electron.profile, { recursive: true, force: true })
})

describe('opening saved passwords at startup', () => {
  it('waits for secure storage without publishing anything, then tells both shell windows once it answers', async () => {
    // A keyring that stayed locked at sign-in answers only once the person unlocks it.
    let unlock!: (available: boolean) => void
    electron.answer = new Promise((resolve) => { unlock = resolve })
    const { credentials, state, sendToShellWindows } = runtime()

    let opened = false
    const opening = credentials.configureCredentialStore().then(() => { opened = true })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(opened).toBe(false)
    expect(state.storageStatus).toEqual({ available: false, reason: 'Secure storage is initializing.' })
    expect(sendToShellWindows).not.toHaveBeenCalled()

    unlock(true)
    await opening
    expect(state.store).not.toBeNull()
    expect(state.storageStatus).toEqual({ available: true, backend: 'gnome_libsecret' })
    expect(sendToShellWindows).toHaveBeenCalledWith('credentials:status-changed', { available: true, backend: 'gnome_libsecret' })
    expect(sendToShellWindows).toHaveBeenCalledWith('credentials:changed', [])
  })

  it('says why passwords are unavailable on Linux without a keyring, and publishes that', async () => {
    electron.backend = 'basic_text'
    const { credentials, state, sendToShellWindows } = runtime()
    await credentials.configureCredentialStore()
    const status = { available: false, backend: 'basic_text', reason: translate('en-US', 'native.errors.linuxSecrets') }
    expect(state.store).toBeNull()
    expect(state.storageStatus).toEqual(status)
    expect(sendToShellWindows).toHaveBeenCalledWith('credentials:status-changed', status)
  })

  it('keeps passwords unavailable when no keyring answered and Linux fell back to its built-in key', async () => {
    // As when the person dismissed the request to unlock a keyring that stayed locked at sign-in.
    electron.key = 'v10'
    const { credentials, state, sendToShellWindows } = runtime()
    await credentials.configureCredentialStore()
    const status = { available: false, backend: 'gnome_libsecret', reason: translate('en-US', 'native.errors.linuxSecrets') }
    expect(state.store).toBeNull()
    expect(state.storageStatus).toEqual(status)
    expect(sendToShellWindows).toHaveBeenCalledWith('credentials:status-changed', status)
  })

  it('never fails when the store cannot open: passwords stay unavailable and startup carries on', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    // A folder where the vault file belongs cannot be read as one.
    await mkdir(join(electron.profile, 'credentials.json'))
    const { credentials, state, sendToShellWindows } = runtime()
    await expect(credentials.configureCredentialStore()).resolves.toBeUndefined()
    const status = { available: false, backend: 'gnome_libsecret', reason: translate('en-US', 'native.errors.secureStorage') }
    expect(state.store).toBeNull()
    expect(state.storageStatus).toEqual(status)
    expect(sendToShellWindows).toHaveBeenCalledWith('credentials:status-changed', status)
  })
})
