import { describe, expect, it, vi } from 'vitest'
import type { TrustedDialogOptions } from '../src/main/trusted-dialogs/trusted-dialogs.js'

vi.mock('electron', () => ({ app: { getPath: () => '/profile' }, safeStorage: {} }))

const { createCredentialRuntime } = await import('../src/main/credential-runtime.js')
const { translate } = await import('../src/shared/i18n.js')

/** A runtime with an open store that already holds a password for `saved`, answering every question with `response`. */
function runtime(response: number, saved = { origin: 'https://login.example', username: 'grace@example.com' }) {
  const store = {
    has: vi.fn((origin: string, username: string) => origin === saved.origin && username === saved.username),
    save: vi.fn(async () => undefined),
    list: () => []
  }
  const showDialog = vi.fn(async (_options: Omit<TrustedDialogOptions, 'window'>) => ({ response }))
  const sendToShellWindows = vi.fn()
  const credentials = createCredentialRuntime({
    text: (key, parameters) => translate('en-US', key, parameters),
    showDialog,
    mainWindow: () => ({ isDestroyed: () => false }),
    state: { storageStatus: { available: true, backend: 'gnome_libsecret' }, store: store as never },
    sendToShellWindows,
    reportBrowserActionFailure: vi.fn()
  })
  return { credentials, store, showDialog, sendToShellWindows }
}

describe('offering to save a password a page submitted', () => {
  it('asks in Hronaut’s own dialog, naming the website and the username, and saves on Save', async () => {
    const { credentials, store, showDialog, sendToShellWindows } = runtime(1)
    credentials.offerToSaveCredential({ origin: 'https://login.example', username: 'ada@example.com', password: 'correct horse' })
    await vi.waitFor(() => expect(store.save).toHaveBeenCalledOnce())
    expect(showDialog).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      title: 'Save password?',
      buttons: ['Not now', 'Save password'],
      defaultId: 1,
      cancelId: 0,
      primaryId: 1,
      variant: { kind: 'save-password', origin: 'https://login.example', username: 'ada@example.com', updating: false, suggested: false }
    }))
    // The system dialog Hronaut falls back to still has the words to ask with.
    expect(showDialog.mock.calls[0]![0]).toMatchObject({ message: 'Save the password for ada@example.com?' })
    expect(store.save).toHaveBeenCalledWith('https://login.example', 'ada@example.com', 'correct horse')
    expect(sendToShellWindows).toHaveBeenCalledWith('credentials:changed', [])
  })

  it('asks to update a saved password, and keeps the password unsaved on Not now', async () => {
    const { credentials, store, showDialog } = runtime(0)
    credentials.offerToSaveCredential({ origin: 'https://login.example', username: 'grace@example.com', password: 'new secret' })
    await vi.waitFor(() => expect(showDialog).toHaveBeenCalledOnce())
    expect(showDialog.mock.calls[0]![0]).toMatchObject({
      title: 'Update saved password?',
      buttons: ['Not now', 'Update password'],
      variant: { kind: 'save-password', origin: 'https://login.example', username: 'grace@example.com', updating: true, suggested: false }
    })
    await Promise.resolve()
    expect(store.save).not.toHaveBeenCalled()
  })

  it('never puts the password in the question', async () => {
    const { credentials, showDialog } = runtime(0)
    credentials.offerToSaveCredential({ origin: 'https://login.example', username: '', password: 'never-shown-secret' })
    await vi.waitFor(() => expect(showDialog).toHaveBeenCalledOnce())
    expect(JSON.stringify(showDialog.mock.calls[0]![0])).not.toContain('never-shown-secret')
    expect(showDialog.mock.calls[0]![0]).toMatchObject({ variant: { kind: 'save-password', username: '' } })
  })

  it('says that nothing shows a password Hronaut suggested for the website, in both dialogs', async () => {
    const { credentials, store, showDialog } = runtime(1)
    credentials.rememberSuggestedPassword('https://login.example', 'k7Gm2xPqR9sTv4w')
    credentials.offerToSaveCredential({ origin: 'https://login.example', username: 'ada@example.com', password: 'k7Gm2xPqR9sTv4w' })
    await vi.waitFor(() => expect(store.save).toHaveBeenCalledOnce())
    const options = showDialog.mock.calls[0]![0]
    expect(options.variant).toEqual({ kind: 'save-password', origin: 'https://login.example', username: 'ada@example.com', updating: false, suggested: true })
    // The system dialog Hronaut falls back to says it too.
    expect(options.detail).toBe("https://login.example\n\nPasswords are encrypted with the operating system's secure storage. The vault itself is never exposed through MCP.\n\nHronaut suggested this password and never shows it. Save it, or you will need to reset it to sign in again.")
    expect(JSON.stringify(options)).not.toContain('k7Gm2xPqR9sTv4w')
    expect(store.save).toHaveBeenCalledWith('https://login.example', 'ada@example.com', 'k7Gm2xPqR9sTv4w')
  })

  it('treats a password as Hronaut’s suggestion only for the website it was suggested for', async () => {
    const { credentials, showDialog } = runtime(0)
    credentials.rememberSuggestedPassword('https://other.example', 'k7Gm2xPqR9sTv4w')
    credentials.rememberSuggestedPassword('https://login.example', 'a-different-one')
    credentials.offerToSaveCredential({ origin: 'https://login.example', username: 'ada@example.com', password: 'k7Gm2xPqR9sTv4w' })
    await vi.waitFor(() => expect(showDialog).toHaveBeenCalledOnce())
    expect(showDialog.mock.calls[0]![0]).toMatchObject({ variant: { suggested: false } })
    expect(showDialog.mock.calls[0]![0].detail).not.toContain('Hronaut suggested')
  })
})
