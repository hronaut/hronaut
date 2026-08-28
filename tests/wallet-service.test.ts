import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WalletService } from '../src/main/wallet/service.js'
import type { WalletSafeStorage } from '../src/main/wallet/key-provider.js'

const temporaryDirectories: string[] = []
afterEach(async () => {
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
      expiresAt: '2026-08-29T12:00:00.000Z', maximumOperationCount: 1,
      requireSuccessfulSimulation: true, allowMessageSigning: false
    })).rejects.toThrow('not eligible for automatic approval')
  })
})
