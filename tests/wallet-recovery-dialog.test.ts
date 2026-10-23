import { describe, expect, it, vi } from 'vitest'
import type { BrowserWindow, MessageBoxReturnValue } from 'electron'
import type { TrustedDialogOptions } from '../src/main/trusted-dialogs/trusted-dialogs.js'
import type { WalletCreateInput, WalletDescriptor } from '../src/shared/wallet.js'

vi.mock('electron', () => ({ app: { getPath: () => '/profile' }, safeStorage: {} }))

const { createWalletRuntime } = await import('../src/main/wallet/runtime.js')
const { walletStartupFailureStatus } = await import('../src/main/wallet/startup-status.js')
const { translate } = await import('../src/shared/i18n.js')

const PHRASE = 'abandon ability able about above absent absorb abstract absurd abuse access accident'
const input: WalletCreateInput = {
  name: 'Treasury',
  chainFamily: 'evm',
  network: { id: '31337', name: 'Anvil', environment: 'local', rpcUrl: 'http://127.0.0.1:8545' },
  workspaceIds: []
}
const wallet: WalletDescriptor = {
  id: 'wallet-1', name: 'Treasury', kind: 'managed', chainFamily: 'evm',
  publicAddress: '0x0000000000000000000000000000000000000001', network: input.network,
  capabilities: ['read', 'sign', 'send'], workspaceIds: [], policyIds: [], recoveryConfirmed: false,
  createdAt: '2026-10-23T12:00:00.000Z', updatedAt: '2026-10-23T12:00:00.000Z'
}

/** A main window whose capture protection the test can read, protected before only when `protectedBefore` is set. */
function mainWindow(protectedBefore = false) {
  let contentProtected = protectedBefore
  const protectionChanges: boolean[] = []
  const window = {
    isDestroyed: () => false,
    isContentProtected: () => contentProtected,
    setContentProtection: (enable: boolean) => {
      contentProtected = enable
      protectionChanges.push(enable)
    }
  }
  return { window: window as unknown as BrowserWindow, protectionChanges, isProtected: () => contentProtected }
}

/** A wallet runtime whose dialogs wait until the test answers them, each with the button index it passes. */
function runtime(owner: BrowserWindow) {
  const service = {
    generate: vi.fn(async (request: WalletCreateInput) => ({ wallet: { ...wallet, name: request.name }, recoveryMaterial: PHRASE })),
    confirmRecovery: vi.fn(async () => ({ ...wallet, recoveryConfirmed: true })),
    remove: vi.fn(async () => true)
  }
  const answers: Array<(response: number) => void> = []
  const showDialog = vi.fn((_options: TrustedDialogOptions<BrowserWindow>) => new Promise<MessageBoxReturnValue>((resolve) => {
    answers.push((response) => resolve({ response, checkboxChecked: false }))
  }))
  const wallets = createWalletRuntime({
    state: { service: service as never, broker: null, unavailableStatus: walletStartupFailureStatus(undefined) },
    sendToMainWindow: vi.fn(),
    commercialLicenseStore: () => null,
    tabs: () => null,
    workspaceStartupFailure: () => undefined,
    mainWindowRefs: { window: owner },
    showDialog,
    text: (key, parameters) => translate('en-US', key, parameters)
  })
  return { wallets, service, showDialog, answer: (index: number, response: number) => answers[index]!(response) }
}

describe('a generated wallet’s recovery phrase', () => {
  it('is shown in Hronaut’s own dialog on the main window, word by word, and the wallet is kept on I saved it', async () => {
    const owner = mainWindow()
    const { wallets, service, showDialog, answer } = runtime(owner.window)
    const generated = wallets.generateWallet(input)
    await vi.waitFor(() => expect(showDialog).toHaveBeenCalledOnce())
    expect(showDialog).toHaveBeenCalledWith(expect.objectContaining({
      type: 'warning',
      buttons: ['I saved it', 'Not yet'],
      defaultId: 1,
      cancelId: 1,
      primaryId: 0,
      window: owner.window,
      variant: { kind: 'wallet-recovery', walletName: 'Treasury', words: PHRASE.split(' ') }
    }))
    // The system dialog Hronaut falls back to, when the window cannot show its own, still shows the phrase.
    expect(showDialog.mock.calls[0]![0].detail).toBe(`${PHRASE}\n\nHronaut cannot recover this phrase. Never share it with a website or coding agent.`)
    answer(0, 0)
    await expect(generated).resolves.toMatchObject({ id: wallet.id, recoveryConfirmed: true })
    expect(service.remove).not.toHaveBeenCalled()
  })

  it('keeps the window out of screen capture only while the phrase is on it', async () => {
    const owner = mainWindow()
    const { wallets, service, showDialog, answer } = runtime(owner.window)
    const generated = wallets.generateWallet(input)
    await vi.waitFor(() => expect(showDialog).toHaveBeenCalledOnce())
    expect(owner.isProtected()).toBe(true)
    answer(0, 1)
    await expect(generated).rejects.toThrow('Wallet creation cancelled before recovery confirmation')
    expect(service.remove).toHaveBeenCalledWith(wallet.id)
    expect(owner.isProtected()).toBe(false)
    expect(owner.protectionChanges).toEqual([true, false])
  })

  it('keeps the window protected until the last of two phrases is answered', async () => {
    const owner = mainWindow()
    const { wallets, showDialog, answer } = runtime(owner.window)
    const first = wallets.generateWallet(input)
    const second = wallets.generateWallet({ ...input, name: 'Operations' })
    await vi.waitFor(() => expect(showDialog).toHaveBeenCalledTimes(2))
    answer(0, 0)
    await expect(first).resolves.toMatchObject({ recoveryConfirmed: true })
    expect(owner.isProtected()).toBe(true)
    answer(1, 0)
    await expect(second).resolves.toMatchObject({ recoveryConfirmed: true })
    expect(owner.isProtected()).toBe(false)
    expect(owner.protectionChanges).toEqual([true, false])
  })

  it('leaves a window that was protected before protected', async () => {
    const owner = mainWindow(true)
    const { wallets, showDialog, answer } = runtime(owner.window)
    const generated = wallets.generateWallet(input)
    await vi.waitFor(() => expect(showDialog).toHaveBeenCalledOnce())
    answer(0, 0)
    await generated
    expect(owner.isProtected()).toBe(true)
    expect(owner.protectionChanges).toEqual([])
  })

  it('ends the protection and discards the wallet when the dialog fails', async () => {
    const owner = mainWindow()
    const { wallets, service, showDialog } = runtime(owner.window)
    showDialog.mockRejectedValueOnce(new Error('The dialog could not be shown'))
    await expect(wallets.generateWallet(input)).rejects.toThrow()
    expect(service.remove).toHaveBeenCalledWith(wallet.id)
    expect(owner.isProtected()).toBe(false)
  })
})
