import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  PassphraseWalletKeyWrapper,
  SafeStorageWalletKeyWrapper,
  type WalletSafeStorage
} from '../src/main/wallet/key-provider.js'
import { WalletVault } from '../src/main/wallet/vault.js'
import { WalletWatchOnlyStore } from '../src/main/wallet/watch-only-store.js'
import type { WalletDescriptor } from '../src/shared/wallet.js'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

async function vaultPath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'hronaut-wallet-vault-test-'))
  temporaryDirectories.push(directory)
  return join(directory, 'profile', 'wallet-vault.json')
}

function descriptor(overrides: Partial<WalletDescriptor> = {}): WalletDescriptor {
  return {
    id: 'wallet-1',
    name: 'EVM test wallet',
    kind: 'managed',
    chainFamily: 'evm',
    publicAddress: '0x0000000000000000000000000000000000000001',
    network: { id: '31337', name: 'Anvil', environment: 'local', rpcUrl: 'http://127.0.0.1:8545' },
    capabilities: ['read', 'sign', 'send'],
    workspaceIds: ['workspace-1'],
    policyIds: [],
    recoveryConfirmed: true,
    createdAt: '2026-08-28T12:00:00.000Z',
    updatedAt: '2026-08-28T12:00:00.000Z',
    ...overrides
  }
}

function fakeSafeStorage(): WalletSafeStorage {
  return {
    isEncryptionAvailable: () => true,
    isAsyncEncryptionAvailable: async () => true,
    getSelectedStorageBackend: () => 'gnome_libsecret',
    encryptStringAsync: async (value) => Buffer.from(`os:${value}`, 'utf8'),
    decryptStringAsync: async (value) => ({
      result: value.toString('utf8').replace(/^os:/, ''),
      shouldReEncrypt: false
    })
  }
}

describe('WalletVault', () => {
  it('atomically persists encrypted managed records and exposes descriptors only', async () => {
    const path = await vaultPath()
    const vault = new WalletVault(path, new SafeStorageWalletKeyWrapper(fakeSafeStorage()))
    await vault.initialize()
    const secret = Buffer.from('test private key material', 'utf8')

    await vault.add(descriptor(), { format: 'private-key', material: secret })

    const persisted = await readFile(path, 'utf8')
    expect(persisted).not.toContain(secret.toString('utf8'))
    expect(vault.list()).toEqual([descriptor()])
    const decrypted = await vault.secret('wallet-1')
    expect(decrypted).toEqual({ format: 'private-key', material: secret })
    decrypted.material.fill(0)
    secret.fill(0)

    const restored = new WalletVault(path, new SafeStorageWalletKeyWrapper(fakeSafeStorage()))
    await restored.load()
    expect(restored.list()).toEqual([descriptor()])
    const restoredSecret = await restored.secret('wallet-1')
    expect(restoredSecret.format).toBe('private-key')
    expect(restoredSecret.material.toString('utf8')).toBe('test private key material')
    restoredSecret.material.fill(0)
  })

  it('supports imported mnemonic, dedicated agent, and watch-only records', async () => {
    const path = await vaultPath()
    const vault = new WalletVault(path, new SafeStorageWalletKeyWrapper(fakeSafeStorage()))
    await vault.initialize()
    await vault.add(descriptor({ id: 'imported', kind: 'imported' }), {
      format: 'mnemonic', material: Buffer.from('test mnemonic phrase')
    })
    await vault.add(descriptor({ id: 'agent', kind: 'agent', name: 'Agent wallet' }), {
      format: 'private-key', material: Buffer.from('agent secret')
    })
    await vault.add(descriptor({
      id: 'watch',
      kind: 'watch-only',
      name: 'Watch',
      capabilities: ['read'],
      recoveryConfirmed: true
    }))

    expect(vault.list().map((wallet) => wallet.id)).toEqual(['agent', 'imported', 'watch'])
    await expect(vault.secret('watch')).rejects.toThrow('Watch-only wallets do not contain signing material')
  })

  it('keeps watch-only functionality while locked and clears decrypted signing access', async () => {
    const path = await vaultPath()
    const vault = new WalletVault(path, new SafeStorageWalletKeyWrapper(fakeSafeStorage()))
    await vault.initialize()
    await vault.add(descriptor(), { format: 'private-key', material: Buffer.from('secret') })
    await vault.add(descriptor({ id: 'watch', kind: 'watch-only', capabilities: ['read'] }))

    vault.lock()

    expect(vault.list()).toHaveLength(2)
    expect(vault.list().find((entry) => entry.id === 'watch')).toBeDefined()
    await expect(vault.secret('wallet-1')).rejects.toThrow('Wallet vault is locked')
  })

  it('unlocks a passphrase-protected vault and rejects an incorrect passphrase with a sanitized error', async () => {
    const path = await vaultPath()
    const wrapper = new PassphraseWalletKeyWrapper({ memoryKiB: 8 * 1024, passes: 2, parallelism: 1 })
    const vault = new WalletVault(path, wrapper)
    const passphrase = Buffer.from('vault test passphrase')
    await vault.initialize(passphrase)
    await vault.add(descriptor(), { format: 'private-key', material: Buffer.from('secret') })
    vault.lock()

    const restored = new WalletVault(path, wrapper)
    await restored.load()
    await expect(restored.unlock(Buffer.from('wrong passphrase'))).rejects.toThrow('Wallet vault unlock failed')
    await restored.unlock(passphrase)
    const secret = await restored.secret('wallet-1')
    expect(secret.material.toString('utf8')).toBe('secret')
    secret.material.fill(0)
    passphrase.fill(0)
  })

  it('rejects corrupted and substituted encrypted records', async () => {
    const path = await vaultPath()
    const wrapper = new SafeStorageWalletKeyWrapper(fakeSafeStorage())
    const vault = new WalletVault(path, wrapper)
    await vault.initialize()
    await vault.add(descriptor(), { format: 'private-key', material: Buffer.from('first secret') })
    await vault.add(descriptor({ id: 'wallet-2', publicAddress: '0x0000000000000000000000000000000000000002' }), {
      format: 'private-key', material: Buffer.from('second secret')
    })
    const persisted = JSON.parse(await readFile(path, 'utf8')) as {
      records: Array<{ walletId: string; encrypted: { ciphertext: string } }>
    }
    const [first, second] = persisted.records
    first!.encrypted.ciphertext = second!.encrypted.ciphertext
    await writeFile(path, `${JSON.stringify(persisted, null, 2)}\n`, 'utf8')

    const restored = new WalletVault(path, wrapper)
    await expect(restored.load()).rejects.toThrow('Wallet vault authentication failed')
    expect(restored.isLocked()).toBe(true)
  })

  it('does not unlock a passphrase vault until every encrypted record authenticates', async () => {
    const path = await vaultPath()
    const wrapper = new PassphraseWalletKeyWrapper({ memoryKiB: 8 * 1024, passes: 2, parallelism: 1 })
    const passphrase = Buffer.from('vault test passphrase')
    const created = new WalletVault(path, wrapper)
    await created.initialize(passphrase)
    await created.add(descriptor(), { format: 'private-key', material: Buffer.from('secret') })
    created.lock()

    const persisted = JSON.parse(await readFile(path, 'utf8')) as {
      records: Array<{ encrypted: { ciphertext: string } }>
    }
    persisted.records[0]!.encrypted.ciphertext = 'AAAA'
    await writeFile(path, `${JSON.stringify(persisted, null, 2)}\n`, 'utf8')

    const restored = new WalletVault(path, wrapper)
    await restored.load()
    await expect(restored.unlock(passphrase)).rejects.toThrow('Wallet vault authentication failed')
    expect(restored.isLocked()).toBe(true)
    passphrase.fill(0)
  })

  it('rotates the data-encryption key without changing descriptors or plaintext', async () => {
    const path = await vaultPath()
    const wrapper = new SafeStorageWalletKeyWrapper(fakeSafeStorage())
    const vault = new WalletVault(path, wrapper)
    await vault.initialize()
    await vault.add(descriptor(), { format: 'private-key', material: Buffer.from('secret') })
    const before = await readFile(path, 'utf8')

    await vault.rotateDataEncryptionKey()

    const after = await readFile(path, 'utf8')
    expect(after).not.toBe(before)
    expect(vault.list()).toEqual([descriptor()])
    const secret = await vault.secret('wallet-1')
    expect(secret.material.toString('utf8')).toBe('secret')
    secret.material.fill(0)
  })

  it('migrates the legacy vault envelope atomically and preserves authenticated records', async () => {
    const path = await vaultPath()
    const wrapper = new SafeStorageWalletKeyWrapper(fakeSafeStorage())
    const created = new WalletVault(path, wrapper)
    await created.initialize()
    await created.add(descriptor(), { format: 'private-key', material: Buffer.from('migration secret') })
    const legacy = JSON.parse(await readFile(path, 'utf8')) as { version: number }
    legacy.version = 0
    await writeFile(path, `${JSON.stringify(legacy, null, 2)}\n`, 'utf8')

    const restored = new WalletVault(path, wrapper)
    await restored.load()

    expect(JSON.parse(await readFile(path, 'utf8'))).toMatchObject({ version: 1 })
    expect(restored.list()).toEqual([descriptor()])
    const secret = await restored.secret('wallet-1')
    expect(secret.material.toString('utf8')).toBe('migration secret')
    secret.material.fill(0)
  })

  it('rewraps the data key after operating-system key rotation', async () => {
    const path = await vaultPath()
    let encryptions = 0
    const storage = fakeSafeStorage()
    storage.encryptStringAsync = async (value) => {
      encryptions += 1
      return Buffer.from(`os:${value}`, 'utf8')
    }
    let requiresReEncryption = true
    storage.decryptStringAsync = async (value) => {
      const shouldReEncrypt = requiresReEncryption
      requiresReEncryption = false
      return {
        result: value.toString('utf8').replace(/^os:/, ''),
        shouldReEncrypt
      }
    }
    const wrapper = new SafeStorageWalletKeyWrapper(storage)
    const created = new WalletVault(path, wrapper)
    await created.initialize()
    created.lock()

    const restored = new WalletVault(path, wrapper)
    await restored.load()

    expect(encryptions).toBe(2)
  })

  it('refuses duplicate wallet ids and signing material for watch-only records', async () => {
    const path = await vaultPath()
    const vault = new WalletVault(path, new SafeStorageWalletKeyWrapper(fakeSafeStorage()))
    await vault.initialize()
    await expect(vault.add(descriptor())).rejects.toThrow('Managed wallets require signing material')
    await vault.add(descriptor({ kind: 'watch-only', capabilities: ['read'] }))
    await expect(vault.add(descriptor({ kind: 'watch-only', capabilities: ['read'] })))
      .rejects.toThrow('Wallet already exists')
    await expect(vault.add(descriptor({ id: 'watch-secret', kind: 'watch-only', capabilities: ['read'] }), {
      format: 'private-key', material: Buffer.from('must reject')
    })).rejects.toThrow('Watch-only wallets must not contain signing material')
  })

  it('updates only mutable descriptor fields and atomically removes encrypted records', async () => {
    const path = await vaultPath()
    const vault = new WalletVault(path, new SafeStorageWalletKeyWrapper(fakeSafeStorage()))
    await vault.initialize()
    await vault.add(descriptor(), { format: 'private-key', material: Buffer.alloc(32, 7) })

    const updated = await vault.updateDescriptor('wallet-1', (wallet) => ({
      ...wallet,
      name: 'Renamed',
      workspaceIds: ['workspace-2'],
      recoveryConfirmed: true,
      updatedAt: '2026-08-28T12:30:00.000Z'
    }))
    expect(updated).toMatchObject({ name: 'Renamed', workspaceIds: ['workspace-2'], recoveryConfirmed: true })
    const retainedSecret = await vault.secret('wallet-1')
    expect(retainedSecret.material).toEqual(Buffer.alloc(32, 7))
    retainedSecret.material.fill(0)
    await expect(vault.updateDescriptor('wallet-1', (wallet) => ({
      ...wallet, publicAddress: '0x2222222222222222222222222222222222222222'
    }))).rejects.toThrow('Wallet public address cannot be changed')

    await expect(vault.remove('wallet-1')).resolves.toBe(true)
    await expect(vault.remove('wallet-1')).resolves.toBe(false)
    await expect(vault.secret('wallet-1')).rejects.toThrow('Wallet not found')
  })
})

describe('WalletWatchOnlyStore', () => {
  it('preserves public read-only wallets without requiring a managed vault backend', async () => {
    const path = await vaultPath()
    const store = new WalletWatchOnlyStore(path)
    await store.load()
    const watchOnly = descriptor({ kind: 'watch-only', capabilities: ['read'] })

    await store.add(watchOnly)
    const restored = new WalletWatchOnlyStore(path)
    await expect(restored.load()).resolves.toEqual([watchOnly])
    await expect(restored.update('wallet-1', (wallet) => ({ ...wallet, name: 'Public account' })))
      .resolves.toMatchObject({ name: 'Public account' })
    await expect(restored.remove('wallet-1')).resolves.toBe(true)
    await expect(restored.remove('wallet-1')).resolves.toBe(false)
  })

  it('rejects secret-bearing or signing-capable records', async () => {
    const store = new WalletWatchOnlyStore(await vaultPath())
    await store.load()
    await expect(store.add(descriptor())).rejects.toThrow('Only watch-only wallets may use this store')
    await expect(store.add(descriptor({ kind: 'watch-only', capabilities: ['read', 'sign'] }))).rejects.toThrow()
  })
})
