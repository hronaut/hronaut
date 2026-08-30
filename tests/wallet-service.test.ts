import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WalletService } from '../src/main/wallet/service.js'
import type { WalletSafeStorage } from '../src/main/wallet/key-provider.js'

const temporaryDirectories: string[] = []
afterEach(async () => {
  vi.useRealTimers()
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

async function directory(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'hronaut-wallet-service-test-'))
  temporaryDirectories.push(path)
  return path
}

function storage(backend: ReturnType<WalletSafeStorage['getSelectedStorageBackend']> = 'gnome_libsecret'): WalletSafeStorage {
  return {
    isEncryptionAvailable: () => true,
    isAsyncEncryptionAvailable: async () => true,
    getSelectedStorageBackend: () => backend,
    encryptStringAsync: async (value) => Buffer.from(`safe:${value}`),
    decryptStringAsync: async (value) => ({ result: value.toString().replace(/^safe:/, ''), shouldReEncrypt: false })
  }
}

const network = { id: '31337', name: 'Anvil', environment: 'local' as const, rpcUrl: 'http://127.0.0.1:8545' }
const knownMnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'

describe('WalletService', () => {
  it('waits for every wallet store load to settle before reporting an integrity failure', async () => {
    const path = await directory()
    const service = new WalletService({ directory: path, platform: 'linux', safeStorage: storage() })
    let resolveApprovalLoad!: (value: Awaited<ReturnType<typeof service.approvals.load>>) => void
    const delayedApprovalLoad = new Promise<Awaited<ReturnType<typeof service.approvals.load>>>((resolve) => {
      resolveApprovalLoad = resolve
    })
    vi.spyOn(service.approvals, 'load').mockReturnValue(delayedApprovalLoad)
    vi.spyOn(service.audit, 'verify').mockRejectedValue(new Error('Wallet audit history verification failed'))

    const initialization = service.initialize()
    let settled = false
    void initialization.then(() => { settled = true }, () => { settled = true })
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(settled).toBe(false)

    resolveApprovalLoad([])
    await expect(initialization).rejects.toThrow('Wallet audit history verification failed')
  })

  it('generates separate managed and agent wallets, gates recovery, and never persists plaintext recovery material', async () => {
    const path = await directory()
    const changed = vi.fn()
    const service = new WalletService({ directory: path, platform: 'linux', safeStorage: storage(), onChanged: changed })
    await service.initialize()

    const generated = await service.generate({
      name: 'EVM wallet', chainFamily: 'evm', network, workspaceIds: ['workspace-1'], dedicatedAgent: false
    })
    const agent = await service.generate({
      name: 'Agent wallet', chainFamily: 'solana', network: { ...network, id: 'localnet' }, workspaceIds: ['workspace-2'], dedicatedAgent: true
    })

    expect(generated.wallet).toMatchObject({ kind: 'managed', recoveryConfirmed: false, chainFamily: 'evm' })
    expect(agent.wallet).toMatchObject({ kind: 'agent', recoveryConfirmed: false, chainFamily: 'solana' })
    expect(generated.recoveryMaterial.split(' ')).toHaveLength(12)
    await expect(service.confirmRecovery(generated.wallet.id)).resolves.toMatchObject({ recoveryConfirmed: true })
    expect(await readFile(join(path, 'vault.json'), 'utf8')).not.toContain(generated.recoveryMaterial)
    expect(changed).toHaveBeenCalled()
  })

  it('prepares imported secrets in main memory and persists only after public-address confirmation', async () => {
    const path = await directory()
    const service = new WalletService({ directory: path, platform: 'linux', safeStorage: storage() })
    await service.initialize()

    const prepared = await service.prepareImport('evm', 'mnemonic', knownMnemonic)
    expect(prepared.publicAddress).toBe('0x9858EfFD232B4033E47d90003D41EC34EcaEda94')
    expect(service.list()).toHaveLength(0)
    const imported = await service.confirmImport(prepared.token, {
      name: 'Imported', network, workspaceIds: ['workspace-1'], dedicatedAgent: false
    })
    expect(imported).toMatchObject({ kind: 'imported', publicAddress: prepared.publicAddress, recoveryConfirmed: true })
    await expect(service.confirmImport(prepared.token, {
      name: 'Replay', network, workspaceIds: [], dedicatedAgent: false
    })).rejects.toThrow('Wallet import confirmation expired')
    expect(await readFile(join(path, 'vault.json'), 'utf8')).not.toContain(knownMnemonic)
  })

  it('drops unconfirmed imported secret material when its confirmation expires while idle', async () => {
    vi.useFakeTimers()
    const path = await directory()
    const service = new WalletService({ directory: path, platform: 'linux', safeStorage: storage() })
    await service.initialize()

    const prepared = await service.prepareImport('evm', 'mnemonic', knownMnemonic)
    await vi.advanceTimersByTimeAsync(5 * 60_000)

    expect(service.cancelImport(prepared.token)).toBe(false)
    await expect(service.confirmImport(prepared.token, {
      name: 'Expired', network, workspaceIds: [], dedicatedAgent: false
    })).rejects.toThrow('Wallet import confirmation expired')
  })

  it('keeps watch-only wallets available when Linux safeStorage is basic_text and requires passphrase setup for managed wallets', async () => {
    const path = await directory()
    const service = new WalletService({ directory: path, platform: 'linux', safeStorage: storage('basic_text') })
    await service.initialize()

    expect(service.status()).toMatchObject({ managedWallets: 'passphrase-setup-required', backend: 'basic_text', watchOnlyAvailable: true })
    const watch = await service.addWatchOnly({
      name: 'Watch', chainFamily: 'evm', publicAddress: '0x0000000000000000000000000000000000000001',
      network, workspaceIds: ['workspace-1']
    })
    expect(watch).toMatchObject({ kind: 'watch-only', capabilities: ['read'] })
    await expect(service.generate({ name: 'No vault', chainFamily: 'evm', network, workspaceIds: [] }))
      .rejects.toThrow('Managed wallet vault is unavailable or locked')

    await service.setupPassphrase('correct horse battery staple')
    await expect(service.generate({ name: 'Now secure', chainFamily: 'evm', network, workspaceIds: [] }))
      .resolves.toHaveProperty('wallet.kind', 'managed')
    service.lock()
    expect(service.status().managedWallets).toBe('locked')
    expect(service.list()).toContainEqual(watch)
    await expect(service.unlock('correct horse battery staple')).resolves.toMatchObject({ managedWallets: 'ready' })
  })

  it('keeps a passphrase vault locked when an encrypted record fails authentication', async () => {
    const path = await directory()
    const passphrase = 'correct horse battery staple'
    const created = new WalletService({ directory: path, platform: 'linux', safeStorage: storage('basic_text') })
    await created.initialize()
    await created.setupPassphrase(passphrase)
    await created.generate({ name: 'Managed', chainFamily: 'evm', network, workspaceIds: [] })
    created.dispose()

    const vaultPath = join(path, 'vault.json')
    const persisted = JSON.parse(await readFile(vaultPath, 'utf8')) as {
      records: Array<{ encrypted: { ciphertext: string } }>
    }
    persisted.records[0]!.encrypted.ciphertext = 'AAAA'
    await writeFile(vaultPath, `${JSON.stringify(persisted, null, 2)}\n`, 'utf8')

    const restored = new WalletService({ directory: path, platform: 'linux', safeStorage: storage('basic_text') })
    await restored.initialize()
    expect(restored.status().managedWallets).toBe('locked')
    await expect(restored.unlock(passphrase)).rejects.toThrow('Wallet vault authentication failed')
    expect(restored.status().managedWallets).toBe('locked')
  })

  it('keeps an existing passphrase vault usable after Linux gains a secure keyring', async () => {
    const path = await directory()
    const created = new WalletService({ directory: path, platform: 'linux', safeStorage: storage('basic_text') })
    await created.initialize()
    await created.setupPassphrase('correct horse battery staple')
    await created.generate({ name: 'Passphrase wallet', chainFamily: 'evm', network, workspaceIds: [] })
    created.dispose()

    const restored = new WalletService({ directory: path, platform: 'linux', safeStorage: storage('gnome_libsecret') })
    await expect(restored.initialize()).resolves.toBeUndefined()
    expect(restored.status()).toMatchObject({
      managedWallets: 'locked',
      backend: 'passphrase',
      watchOnlyAvailable: true
    })
    await expect(restored.unlock('correct horse battery staple')).resolves.toMatchObject({ managedWallets: 'ready' })
  })

  it('keeps watch-only support available when an existing secure-storage vault backend disappears', async () => {
    const path = await directory()
    const created = new WalletService({ directory: path, platform: 'linux', safeStorage: storage('gnome_libsecret') })
    await created.initialize()
    await created.generate({ name: 'Keyring wallet', chainFamily: 'evm', network, workspaceIds: [] })
    created.dispose()

    const restored = new WalletService({ directory: path, platform: 'linux', safeStorage: storage('basic_text') })
    await expect(restored.initialize()).resolves.toBeUndefined()
    expect(restored.status()).toMatchObject({
      managedWallets: 'disabled',
      backend: 'basic_text',
      watchOnlyAvailable: true
    })
    await expect(restored.addWatchOnly({
      name: 'Still readable',
      chainFamily: 'evm',
      publicAddress: '0x0000000000000000000000000000000000000001',
      network,
      workspaceIds: []
    })).resolves.toMatchObject({ kind: 'watch-only' })
    restored.lock()
    expect(restored.status().managedWallets).toBe('disabled')
  })

  it('supports public descriptor updates/removal and records only non-secret audit fields', async () => {
    const path = await directory()
    const service = new WalletService({ directory: path, platform: 'linux', safeStorage: storage() })
    await service.initialize()
    const prepared = await service.prepareImport('evm', 'mnemonic', knownMnemonic)
    const wallet = await service.confirmImport(prepared.token, { name: 'Imported', network, workspaceIds: ['one'], dedicatedAgent: false })

    await expect(service.update(wallet.id, { name: 'Renamed', workspaceIds: ['two', 'two'] }))
      .resolves.toMatchObject({ name: 'Renamed', workspaceIds: ['two'] })
    await expect(service.remove(wallet.id)).resolves.toBe(true)
    const audit = await readFile(join(path, 'audit.jsonl'), 'utf8')
    expect(audit).not.toMatch(/abandon|mnemonic|private.?key|ciphertext/i)
    expect(audit).toContain('wallet-removed')
  })

  it('rejects bounded automatic policies for networks that are not independently recognized as local or testnet', async () => {
    const path = await directory()
    const service = new WalletService({ directory: path, platform: 'linux', safeStorage: storage() })
    await service.initialize()
    const generated = await service.generate({
      name: 'Mislabelled mainnet', chainFamily: 'evm',
      network: { id: '1', name: 'Not really testnet', environment: 'testnet', rpcUrl: 'https://rpc.example' },
      workspaceIds: ['workspace-1']
    })

    await expect(service.setPolicy({
      id: 'policy-unsafe', name: 'Unsafe automation', mode: 'bounded-auto', walletId: generated.wallet.id,
      workspaceId: 'workspace-1', networkIds: ['1'], origins: ['https://dapp.example'],
      destinations: ['0x0000000000000000000000000000000000000002'], methods: ['native-transfer'],
      expiresAt: '2099-08-29T12:00:00.000Z', maximumOperationCount: 1,
      requireSuccessfulSimulation: true, allowMessageSigning: false
    })).rejects.toThrow('not eligible for automatic approval')
  })

  it('rejects policy URLs that are not origins and policies that have already expired', async () => {
    const path = await directory()
    const now = new Date('2026-08-29T12:00:00.000Z')
    const service = new WalletService({ directory: path, platform: 'linux', safeStorage: storage(), now: () => now })
    await service.initialize()
    const generated = await service.generate({
      name: 'Local wallet', chainFamily: 'evm', network, workspaceIds: ['workspace-1']
    })
    const policy = {
      id: 'policy-invalid', name: 'Invalid automation', mode: 'bounded-auto' as const,
      walletId: generated.wallet.id, workspaceId: 'workspace-1', networkIds: ['31337'],
      destinations: ['0x0000000000000000000000000000000000000002'], methods: ['native-transfer'],
      maximumOperationCount: 1, requireSuccessfulSimulation: true as const, allowMessageSigning: false
    }

    await expect(service.setPolicy({
      ...policy, origins: ['https://dapp.example/swap'], expiresAt: '2026-08-29T13:00:00.000Z'
    })).rejects.toThrow('Wallet policy origin must be a normalized HTTP or HTTPS origin')
    await expect(service.setPolicy({
      ...policy, origins: ['https://dapp.example'], expiresAt: '2026-08-29T11:59:59.999Z'
    })).rejects.toThrow('Wallet policy expiry must be in the future')
    expect(service.policies.list()).toEqual([])
  })
})
