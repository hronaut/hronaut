import { afterEach, describe, expect, it, vi } from 'vitest'
import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { WalletPolicy } from '../src/shared/wallet.js'

vi.mock('electron', () => ({ session: {}, WebContentsView: class {}, nativeImage: {}, shell: {}, app: { getPath: () => '/tmp' }, Menu: {} }))
vi.mock('node:fs/promises', async (importOriginal) => {
  const fs = await importOriginal<typeof import('node:fs/promises')>()
  return { ...fs, open: vi.fn(fs.open) }
})

const { LocalizedError, withTranslatedIpcErrors } = await import('../src/main/localized-error.js')
const { translate } = await import('../src/shared/i18n.js')
const { BrowserTabsManager } = await import('../src/main/browser/tabs-manager.js')
const { fillCredentialWhileMcpPaused } = await import('../src/main/credential-fill-pause.js')
const { CredentialStore } = await import('../src/main/credential-store.js')
const { emulate } = await import('../src/main/browser/emulation/emulation.js')
const { DEFAULT_EMULATION } = await import('../src/main/browser/emulation-state.js')
const { registerWalletIpc } = await import('../src/main/wallet/ipc.js')
const { PassphraseWalletKeyWrapper, SafeStorageWalletKeyWrapper } = await import('../src/main/wallet/key-provider.js')
const { WalletService } = await import('../src/main/wallet/service.js')
const { WALLET_RECOVERY_CANCELLED_MESSAGE, generateWalletWithRecoveryConfirmation } = await import('../src/main/wallet/onboarding.js')
const { approve: approveWalletRequest } = await import('../src/main/wallet/broker/human-approvals.js')
const { sanitizedError } = await import('../src/main/wallet/broker/sanitized-error.js')
const { walletStartupFailureStatus } = await import('../src/main/wallet/startup-status.js')

const SHELL_URL = 'http://127.0.0.1:5173/'
const ukrainian = (key: Parameters<typeof translate>[1], parameters?: Parameters<typeof translate>[2]) => translate('uk-UA', key, parameters)

/** What a page that called a failing IPC handler reads: the shell gets Ukrainian here, a website the English. */
async function shownTo(url: string, error: unknown): Promise<string> {
  const handlers = new Map<string, Parameters<IpcMain['handle']>[1]>()
  const ipcMain = { handle: (channel: string, listener: Parameters<IpcMain['handle']>[1]) => { handlers.set(channel, listener) }, on: () => ipcMain }
  withTranslatedIpcErrors(ipcMain as unknown as Pick<IpcMain, 'handle' | 'on'>, {
    isHronautPage: (event) => event.senderFrame?.url === SHELL_URL,
    text: ukrainian
  }).handle('action', () => { throw error })
  const thrown = await Promise.resolve(handlers.get('action')!({ senderFrame: { url } } as unknown as IpcMainInvokeEvent)).catch((caught: unknown) => caught)
  return (thrown as Error).message
}

/** The error an action throws, whether it throws at once or rejects. */
async function failure(action: () => unknown): Promise<unknown> {
  try {
    await action()
  } catch (error) {
    return error
  }
  throw new Error('The action did not fail')
}

const homeTab = { id: 'home', url: 'hronaut://home/', pinned: false, nativeInputEnvironmentGeneration: 0 }
const websiteTab = { id: 'site', url: 'https://example.test/', pinned: false, nativeInputEnvironmentGeneration: 0 }

/** The handler a module registers for a channel, called as the shell calls it. */
async function invokeRegistered(register: (handle: (channel: string, listener: Parameters<IpcMain['handle']>[1]) => void) => void, channel: string, ...args: unknown[]): Promise<unknown> {
  const handlers = new Map<string, Parameters<IpcMain['handle']>[1]>()
  register((name, listener) => { handlers.set(name, listener) })
  return handlers.get(channel)!({ senderFrame: { url: SHELL_URL } } as unknown as IpcMainInvokeEvent, ...args)
}

const credentialDirectories: string[] = []
afterEach(async () => {
  await Promise.all(credentialDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

/** A saved account whose password the given secure storage reads back; it names no real person or password. */
async function savedCredential(decrypt: (store: InstanceType<typeof CredentialStore>, id: () => string) => Promise<{ result: string; shouldReEncrypt: boolean }>) {
  const directory = await mkdtemp(join(tmpdir(), 'hronaut-translated-credentials-'))
  credentialDirectories.push(directory)
  let id = ''
  const store: InstanceType<typeof CredentialStore> = new CredentialStore(join(directory, 'credentials.json'), {
    encrypt: async () => Buffer.from('sealed'),
    decrypt: () => decrypt(store, () => id)
  })
  id = (await store.save('https://accounts.example', 'person', 'placeholder')).id
  return { store, id }
}

/** A website tab whose emulation can be restored, as the Environment panel restores it. */
const emulationTab = {
  ...websiteTab, emulation: DEFAULT_EMULATION, emulationExtraHttpHeaders: {}, emulationApplication: 'unknown', networkConditionApplication: 'confirmed',
  navigationGeneration: 0, observationGeneration: 0, emulationContextGeneration: 0, networkDebuggerEpoch: 0, webContents: { isDestroyed: () => false }
}
const emulationAccess = (tab: object, findTab: () => unknown = () => tab) => ({
  getTab: () => tab, findTab, isDestroyed: () => false, requireEmulationConfirmed: () => undefined, requireNetworkConditionsKnown: () => undefined,
  withDebugger: (_webContents: unknown, run: () => unknown) => run()
})
const confirmedEmulation = BrowserTabsManager.prototype as unknown as { requireEmulationConfirmed(tab: object): void }

/** A wallet service before startup; nothing here is read from or written to disk. */
const walletService = () => new WalletService({
  directory: '/nonexistent/hronaut-wallets', platform: 'linux', safeStorage: {} as never, now: () => new Date('2026-10-19T12:00:00.000Z')
})
const walletPolicy: Omit<WalletPolicy, 'expiresAt'> = {
  id: 'policy-1', name: 'Test automation', mode: 'always-ask', walletId: 'wallet-1', workspaceId: 'workspace-1', networkIds: ['1'],
  origins: [], destinations: [], methods: [], maximumOperationCount: 1, requireSuccessfulSimulation: true, allowMessageSigning: false
}
/** A new wallet whose confirmation the person answers; its recovery phrase is left empty. */
const onboarding = (remove: () => Promise<boolean> = async () => true) => ({
  generate: async () => ({ wallet: { id: 'wallet-1' }, recoveryMaterial: '' }),
  confirmRecovery: async () => { throw new Error('confirmation storage failed') },
  remove
})
const walletIpcHost = { assertMainShellSender: () => undefined, service: () => null, broker: () => null }
const approvals = (record: unknown, lockGenerations: number[] = [0, 0]) => ({
  lockGeneration: () => lockGenerations.shift() ?? 0,
  queueLifecycle: async (operation: () => unknown) => operation(),
  service: { approvals: { get: () => record } }
})

describe('main-process failures people see in password fill, wallets and emulation', () => {
  it.each([
    // Password fill
    ['filling a password while an agent command runs', () => fillCredentialWhileMcpPaused({
      pausePersistently: () => undefined, acquireTemporaryPause: () => () => undefined, getActiveRequestCount: () => 1, fill: async () => true, timeoutMs: 0
    }),
    'Could not fill the password while an MCP command was still active',
    'Пароль не заповнено, бо команда агента ще виконувалася. Агенти залишаються призупиненими; спробуйте ще раз, коли вона завершиться.'],
    ['filling a password that was just removed', () => new CredentialStore('/nonexistent/credentials.json', {} as never).password('credential-1'),
      'Saved credential not found',
      'Збережений пароль більше недоступний.'],
    ['filling a password that changed while it was read', async () => {
      const { store, id } = await savedCredential(async (current, credentialId) => {
        await current.remove(credentialId())
        return { result: 'placeholder', shouldReEncrypt: false }
      })
      return store.password(id)
    },
    'Saved credential changed during access',
    'Збережений пароль змінився під час читання. Спробуйте ще раз.'],
    // Emulation
    ['changing emulation on Home', () => emulate({ getTab: () => homeTab } as never, { reset: true }),
      'Open a website tab before changing browser emulation',
      'Відкрийте вкладку з вебсайтом, щоб змінити емуляцію браузера.'],
    ['restoring emulation after the page navigated', () => emulate(emulationAccess(emulationTab, () => undefined) as never, { tabId: 'site', recover: true }),
      'Emulation target changed',
      'Сторінка змінилася під час застосування емуляції. Спробуйте ще раз.'],
    ['restoring emulation before Network conditions are recovered', () => emulate(emulationAccess({ ...emulationTab, networkConditionApplication: 'unknown' }) as never, { tabId: 'site', recover: true }),
      'Network application must be confirmed before changing or restoring emulation. Recover Network conditions separately.',
      'Спочатку відновіть мережеві умови в Умовах запитів, а потім змініть або відновіть емуляцію.'],
    ['a new change while the last emulation is unconfirmed', () => confirmedEmulation.requireEmulationConfirmed({ emulationApplication: 'unknown' }),
      'Native emulation application is not confirmed. Inspect retained settings and explicitly restore them before a new change; do not replay the failed request.',
      'Емуляцію не підтверджено. Відкрийте Середовище й відновіть збережені налаштування, перш ніж вносити нові зміни.'],
    // Wallet settings
    ['a wallet action before the wallet service starts', () => invokeRegistered((handle) => registerWalletIpc({ handle } as never, walletIpcHost as never), 'wallets:cancel-import', 'import-token'),
      'Wallet service is unavailable',
      'Служба гаманців недоступна.'],
    ['locking wallets before the broker starts', () => invokeRegistered((handle) => registerWalletIpc({ handle } as never, walletIpcHost as never), 'wallets:lock'),
      'Wallet broker is unavailable',
      'Служба гаманців недоступна.'],
    ['a wallet vault secure storage cannot unlock', () => new SafeStorageWalletKeyWrapper({
      decryptStringAsync: async () => { throw new Error('The keyring is locked') }
    } as never).unwrap({ mode: 'safe-storage', wrappedKey: 'AAAA' }),
    'Wallet vault unlock failed',
    'Не вдалося розблокувати сховище гаманців.'],
    ['unlocking a wallet vault with an empty passphrase', () => new PassphraseWalletKeyWrapper({} as never).unwrap({ mode: 'passphrase' } as never),
      'Wallet vault passphrase is required',
      'Потрібна парольна фраза сховища.'],
    ['setting up a passphrase the vault does not need', () => walletService().setupPassphrase(''),
      'Wallet passphrase setup is unavailable',
      'Налаштування парольної фрази сховища недоступне.'],
    ['unlocking a vault that is not locked', () => walletService().unlock(''),
      'Wallet vault is not locked',
      'Сховище гаманців не заблоковано.'],
    ['a wallet policy that already expired', () => walletService().setPolicy({ ...walletPolicy, expiresAt: '2026-01-01T00:00:00.000Z' }),
      'Wallet policy expiry must be in the future',
      'Строк дії політики гаманця має закінчуватися в майбутньому.'],
    ['a wallet policy for a wallet that was removed', () => walletService().setPolicy({ ...walletPolicy, expiresAt: '2099-01-01T00:00:00.000Z' }),
      'Wallet not found',
      'Гаманець не знайдено.'],
    ['cancelling a new wallet before saving its recovery phrase', () => generateWalletWithRecoveryConfirmation(onboarding() as never, {} as never, async () => false),
      'Wallet creation cancelled before recovery confirmation',
      'Створення гаманця скасовано до підтвердження фрази відновлення.'],
    ['a recovery confirmation that could not be saved', () => generateWalletWithRecoveryConfirmation(onboarding() as never, {} as never, async () => true),
      'Wallet recovery confirmation failed',
      'Не вдалося підтвердити фразу відновлення гаманця.'],
    ['a new wallet that could not be removed after its confirmation failed', () => generateWalletWithRecoveryConfirmation(onboarding(async () => false) as never, {} as never, async () => true),
      'Wallet recovery confirmation failed and the unconfirmed wallet could not be removed',
      'Не вдалося підтвердити фразу відновлення, а непідтверджений гаманець не вдалося видалити.'],
    // Wallet approval prompt
    ['approving after signing keys were locked', () => approveWalletRequest(approvals(undefined, [0, 1]) as never, 'request-1'),
      'Wallet request was cancelled because signing keys were locked',
      'Запит гаманця скасовано, бо ключі підписання заблоковано.'],
    ['approving a request that already settled', () => approveWalletRequest(approvals(undefined) as never, 'request-1'),
      'Wallet request not found',
      'Запит гаманця не знайдено.'],
    ['approving a request twice', () => approveWalletRequest(approvals({ id: 'request-1', status: 'approved' }) as never, 'request-1'),
      'Wallet request is not awaiting human approval',
      'Запит гаманця не очікує схвалення людини.']
  ] as const)('%s keeps its English message and reaches the shell in the interface language', async (_name, action, inEnglish, inUkrainian) => {
    const error = await failure(action)
    expect(error).toBeInstanceOf(LocalizedError)
    expect((error as Error).message).toBe(inEnglish)
    await expect(shownTo(SHELL_URL, error)).resolves.toBe(inUkrainian)
    await expect(shownTo('https://site.example/', error)).resolves.toBe(inEnglish)
  })

  it('keeps the secure storage text for logs and tells a person only that the saved password could not be decrypted', async () => {
    const keyring = new Error('Error while decrypting the ciphertext provided to safeStorage.decryptString. Keyring is locked.')
    const { store, id } = await savedCredential(async () => { throw keyring })
    const error = await failure(() => store.password(id))
    expect(error).toBeInstanceOf(LocalizedError)
    expect(error).toMatchObject({ message: keyring.message, cause: keyring })
    const shown = await shownTo(SHELL_URL, error)
    expect(shown).toBe('Не вдалося розшифрувати збережений пароль. Переконайтеся, що захищене сховище системи розблоковано, і спробуйте ще раз.')
    for (const detail of ['safeStorage', 'Keyring', 'ciphertext', 'person', 'placeholder', 'accounts.example']) expect(shown).not.toContain(detail)
  })

  it('gives the waiting page and agent the same sanitized English when a request expired before a person approved it', async () => {
    const rejected: unknown[] = []
    const record = { id: 'request-1', status: 'awaiting-human', request: { walletId: 'wallet-1', requester: { type: 'page' }, topLevelOrigin: 'https://dapp.example' } }
    const access = {
      ...approvals(record),
      service: {
        approvals: { get: () => record, approve: async () => { record.status = 'expired'; throw new Error('Wallet request expired') } },
        audit: { append: async () => undefined }
      },
      rejectPending: (_id: string, error: unknown) => { rejected.push(error) },
      publish: () => undefined,
      now: () => new Date('2026-10-19T12:00:00.000Z')
    }
    const error = await failure(() => approveWalletRequest(access as never, 'request-1'))
    expect(error).toBeInstanceOf(LocalizedError)
    expect((error as Error).message).toBe('Wallet request expired before approval')
    await expect(shownTo(SHELL_URL, error)).resolves.toBe('Строк дії запиту гаманця минув до схвалення.')
    expect(rejected).toEqual([error])
    expect(sanitizedError(rejected[0]).message).toBe('Wallet request expired before approval')
  })
})

describe('wallet messages a person now reads in the interface language', () => {
  // Every converted wallet message with the English it had before: the broker passes it on to pages and agents only
  // when it starts with known words, and startup recognizes a secure storage failure by its exact text.
  it.each([
    ['wallet.serviceUnavailable', 'Wallet service is unavailable'],
    ['wallet.windowUnavailable', 'The Hronaut window is unavailable'],
    ['wallet.vaultUnavailable', 'Wallet vault is unavailable'],
    ['wallet.vaultLocked', 'Managed wallet vault is unavailable or locked'],
    ['wallet.passphraseSetupUnavailable', 'Wallet passphrase setup is unavailable'],
    ['wallet.vaultNotLocked', 'Wallet vault is not locked'],
    ['wallet.passphraseRequired', 'Wallet vault passphrase is required'],
    ['wallet.passphraseLength', 'Wallet vault passphrase must be between 12 and 1024 characters'],
    ['wallet.unlockFailed', 'Wallet vault unlock failed'],
    ['wallet.recoveryMaterialInvalid', 'Invalid wallet recovery material'],
    ['wallet.recoveryMaterialMismatch', 'Wallet recovery material is invalid for the selected chain and format'],
    ['wallet.importExpired', 'Wallet import confirmation expired'],
    ['wallet.watchOnlyAddressInvalid', 'Invalid watch-only wallet address'],
    ['wallet.notFound', 'Wallet not found'],
    ['wallet.detachedRequestActive', 'Wallet has a signing or submitted request in a detached workspace'],
    ['wallet.requestActive', 'Wallet has a signing or submitted request in progress'],
    ['wallet.vaultLimit', 'Wallet vault limit reached (10000)'],
    ['wallet.watchOnlyLimit', 'Watch-only wallet limit reached (10000)'],
    ['wallet.recoveryCancelled', WALLET_RECOVERY_CANCELLED_MESSAGE],
    ['wallet.recoveryFailed', 'Wallet recovery confirmation failed'],
    ['wallet.recoveryRollbackFailed', 'Wallet recovery confirmation failed and the unconfirmed wallet could not be removed'],
    ['wallet.requestNotFound', 'Wallet request not found'],
    ['wallet.requestNotAwaiting', 'Wallet request is not awaiting human approval'],
    ['wallet.requestExpired', 'Wallet request expired before approval'],
    ['wallet.requestCancelledLocked', 'Wallet request was cancelled because signing keys were locked'],
    ['walletPolicy.expiryPast', 'Wallet policy expiry must be in the future'],
    ['walletPolicy.signingUnsupported', 'Wallet does not support signing automation'],
    ['walletPolicy.workspaceDetached', 'Wallet policy workspace is not attached to the wallet'],
    ['walletPolicy.networkMissing', 'Wallet policy must include the wallet network'],
    ['walletPolicy.signInNeedsBounded', 'Website sign-in without approval requires a bounded automatic policy'],
    ['walletPolicy.mainnetSignInNeedsSignIn', 'The mainnet website sign-in switch requires website sign-in without approval'],
    ['walletPolicy.signInEvmOnly', 'Website sign-in without approval is only available for EVM wallets'],
    ['walletPolicy.signInNeedsOrigin', 'Website sign-in without approval requires an allowed website origin'],
    ['walletPolicy.mainnetTypedDataNeedsTypedData', 'The mainnet typed-data switch requires typed-data signing without approval'],
    ['walletPolicy.typedDataNeedsSignIn', 'Typed-data signing without approval requires website sign-in without approval'],
    ['walletPolicy.typedDataNeedsAgent', 'Typed-data signing without approval requires a dedicated agent wallet'],
    ['walletPolicy.mainnetTypedDataNeedsSwitch', 'Mainnet typed-data signing without approval requires its separate mainnet switch'],
    ['walletPolicy.mainnetTypedDataMainnetOnly', 'The mainnet typed-data switch is only valid for a mainnet wallet'],
    ['walletPolicy.anyTokenWithContract', 'A wallet policy that allows any token contract cannot also name one'],
    ['walletPolicy.tokenMethodNeedsContract', 'A wallet policy for a token method must name its token contract or allow any token contract'],
    ['walletPolicy.mainnetBypassNeedsAgent', 'Mainnet Bypass Approve mode requires a dedicated EVM agent wallet'],
    ['walletPolicy.mainnetBypassOneContract', 'Mainnet Bypass Approve mode allows one token contract'],
    ['walletPolicy.mainnetBypassLimits', 'Mainnet Bypass Approve mode requires complete transaction, spend, fee, operation, and expiry limits'],
    ['walletPolicy.mainnetSignInLimits', 'Mainnet website sign-in without approval requires its separate mainnet switch, one website origin, at most 100 operations and an expiry within 7 days'],
    ['walletPolicy.mainnetSignInNoTransactions', 'A mainnet sign-in policy without Bypass Approve cannot list transaction destinations, contracts or methods'],
    ['walletPolicy.bypassMainnetOnly', 'Bypass Approve mode is only valid for a mainnet agent policy'],
    ['walletPolicy.mainnetSignInMainnetOnly', 'The mainnet website sign-in switch is only valid for a mainnet wallet'],
    ['walletPolicy.networkIneligible', 'Wallet network is not eligible for automatic approval'],
    ['walletPolicy.identityMoved', 'Wallet policy identity cannot be moved between wallets'],
    ['walletPolicy.removedDuringRemoval', 'Wallet policy disappeared during removal'],
    ['walletPolicy.saveRollbackFailed', 'Wallet policy descriptor update failed and its rollback was incomplete'],
    ['walletPolicy.removeRollbackFailed', 'Wallet policy removal failed and its rollback was incomplete']
  ] as const)('%s keeps the English that pages, agents and startup read', (key, english) => {
    const error = new LocalizedError(`appErrors.${key}`, { max: 10_000 })
    expect(error.message).toBe(english)
    expect(error.name).toBe('Error')
    const passedOn = sanitizedError(error)
    expect(passedOn).not.toBeInstanceOf(LocalizedError)
    expect(passedOn.message).toBe(sanitizedError(new Error(english)).message)
    expect(walletStartupFailureStatus(error)).toEqual(walletStartupFailureStatus(new Error(english)))
    expect(ukrainian(`appErrors.${key}`, { max: 10_000 })).not.toBe(english)
  })

  it('still disables managed wallets as a secure storage failure when the vault cannot be unlocked at startup', async () => {
    const error = await failure(() => new SafeStorageWalletKeyWrapper({
      decryptStringAsync: async () => { throw new Error('The keyring is locked') }
    } as never).unwrap({ mode: 'safe-storage', wrappedKey: 'AAAA' }))
    expect(walletStartupFailureStatus(error)).toMatchObject({ managedWallets: 'disabled', backend: 'secure-storage-failure' })
    expect(sanitizedError(error).message).toBe('Wallet vault unlock failed')
  })
})
