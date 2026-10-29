import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const electron = vi.hoisted(() => ({
  profile: '',
  answer: Promise.resolve(true) as Promise<boolean>
}))
vi.mock('electron', () => ({
  app: { getPath: () => electron.profile },
  safeStorage: {
    isAsyncEncryptionAvailable: () => electron.answer,
    getSelectedStorageBackend: () => 'basic_text',
    encryptStringAsync: async (value: string) => Buffer.from(`v11${value}`),
    decryptStringAsync: async (value: Buffer) => ({ result: value.toString().slice(3), shouldReEncrypt: false })
  }
}))

const { createWalletRuntime } = await import('../src/main/wallet/runtime.js')
const { walletStartingStatus } = await import('../src/main/wallet/startup-status.js')
const { WALLET_DISABLED_REASONS } = await import('../src/shared/wallet.js')
const { translate } = await import('../src/shared/i18n.js')

function runtime() {
  const state = { service: null, broker: null, unavailableStatus: walletStartingStatus() } as Parameters<typeof createWalletRuntime>[0]['state']
  const sendToMainWindow = vi.fn()
  const wallets = createWalletRuntime({
    state,
    sendToMainWindow,
    commercialLicenseStore: () => null,
    tabs: () => null,
    workspaceStartupFailure: () => undefined,
    mainWindowRefs: { window: null },
    showDialog: vi.fn(),
    text: (key, parameters) => translate('en-US', key, parameters)
  })
  return { wallets, state, sendToMainWindow }
}

beforeEach(async () => {
  electron.profile = await mkdtemp(join(tmpdir(), 'hronaut-wallet-startup-'))
  electron.answer = Promise.resolve(true)
})

afterEach(async () => {
  vi.restoreAllMocks()
  await rm(electron.profile, { recursive: true, force: true })
})

describe('starting wallets at startup', () => {
  it('says the wallet service has not started while secure storage waits, then publishes its status and wallets', async () => {
    // A keyring that stayed locked at sign-in answers only once the person unlocks it.
    let unlock!: (available: boolean) => void
    electron.answer = new Promise((resolve) => { unlock = resolve })
    const { wallets, state, sendToMainWindow } = runtime()

    let started = false
    const starting = wallets.startWallets().then(() => { started = true })
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(started).toBe(false)
    expect(wallets.currentWalletServiceStatus()).toMatchObject({ managedWallets: 'disabled', reason: WALLET_DISABLED_REASONS.notInitialized })
    expect(sendToMainWindow).not.toHaveBeenCalled()

    unlock(true)
    await starting
    expect(state.service).not.toBeNull()
    const status = wallets.currentWalletServiceStatus()
    expect(status.reason).not.toBe(WALLET_DISABLED_REASONS.notInitialized)
    expect(sendToMainWindow).toHaveBeenCalledWith('wallets:status-changed', status)
    expect(sendToMainWindow).toHaveBeenCalledWith('wallets:changed', [])
    state.service?.dispose()
  })

  it('publishes why wallets are off when they cannot start', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    // A file where the wallet folder belongs.
    await writeFile(join(electron.profile, 'wallet'), 'not a folder')
    const { wallets, state, sendToMainWindow } = runtime()
    await expect(wallets.startWallets()).resolves.toBeUndefined()
    expect(state.service).toBeNull()
    const status = wallets.currentWalletServiceStatus()
    expect(status).toMatchObject({ managedWallets: 'disabled', backend: 'initialization-failure' })
    expect(sendToMainWindow).toHaveBeenCalledWith('wallets:status-changed', status)
    expect(sendToMainWindow).toHaveBeenCalledWith('wallets:changed', [])
  })
})
