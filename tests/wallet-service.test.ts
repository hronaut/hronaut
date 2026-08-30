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

  it('rejects malformed EVM chain IDs on every wallet creation path before persisting a descriptor', async () => {
    const path = await directory()
    const service = new WalletService({ directory: path, platform: 'linux', safeStorage: storage() })
    await service.initialize()

    await expect(service.generate({
      name: 'Invalid generated wallet', chainFamily: 'evm',
      network: { ...network, id: 'devnet' }, workspaceIds: []
    })).rejects.toThrow('positive safe integer')
    await expect(service.addWatchOnly({
      name: 'Invalid watch wallet', chainFamily: 'evm',
      publicAddress: '0x0000000000000000000000000000000000000001',
      network: { ...network, id: '-1' }, workspaceIds: []
    })).rejects.toThrow('positive safe integer')

    const prepared = await service.prepareImport('evm', 'mnemonic', knownMnemonic)
    await expect(service.confirmImport(prepared.token, {
      name: 'Invalid imported wallet', network: { ...network, id: '9007199254740992' },
      workspaceIds: [], dedicatedAgent: false
    })).rejects.toThrow('positive safe integer')
    expect(service.list()).toEqual([])
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

  it.each([
    ['solana', 'devnet', 'https://api.mainnet-beta.solana.com'],
    ['tron', 'shasta', 'https://api.trongrid.io']
  ] as const)('rejects %s public-testnet automation until the selected RPC network is independently attested', async (chainFamily, networkId, rpcUrl) => {
    const path = await directory()
    const service = new WalletService({ directory: path, platform: 'linux', safeStorage: storage() })
    await service.initialize()
    const generated = await service.generate({
      name: `${chainFamily} test wallet`, chainFamily,
      network: { id: networkId, name: networkId, environment: 'testnet', rpcUrl },
      workspaceIds: ['workspace-1']
    })

    await expect(service.setPolicy({
      id: `policy-${chainFamily}`, name: 'Unsafe public testnet automation', mode: 'bounded-auto',
      walletId: generated.wallet.id, workspaceId: 'workspace-1', networkIds: [networkId],
      origins: ['https://dapp.example'], destinations: ['destination'], methods: ['transfer'],
      expiresAt: '2099-08-29T12:00:00.000Z', maximumOperationCount: 1,
      requireSuccessfulSimulation: true, allowMessageSigning: false
    })).rejects.toThrow('not eligible for automatic approval')
  })

  it('rejects tampering with encrypted automatic-signing policy authority', async () => {
    const path = await directory()
    const created = new WalletService({ directory: path, platform: 'linux', safeStorage: storage() })
    await created.initialize()
    const generated = await created.generate({
      name: 'Authenticated policy wallet', chainFamily: 'evm', network, workspaceIds: ['workspace-1']
    })
    await created.setPolicy({
      id: 'policy-authenticated', name: 'Local allowance', mode: 'bounded-auto', walletId: generated.wallet.id,
      workspaceId: 'workspace-1', networkIds: ['31337'], origins: ['https://dapp.example'],
      destinations: ['0x0000000000000000000000000000000000000002'], methods: ['native-transfer'],
      maxNativeAmount: '1', dailySpendLimit: '1', expiresAt: '2099-08-29T12:00:00.000Z',
      maximumOperationCount: 1, requireSuccessfulSimulation: true, allowMessageSigning: false
    })
    created.dispose()

    const vaultPath = join(path, 'vault.json')
    const persisted = JSON.parse(await readFile(vaultPath, 'utf8')) as {
      authority: { ciphertext: string }
    }
    persisted.authority.ciphertext = `${persisted.authority.ciphertext.slice(0, -4)}AAAA`
    await writeFile(vaultPath, `${JSON.stringify(persisted, null, 2)}\n`, 'utf8')

    const restored = new WalletService({ directory: path, platform: 'linux', safeStorage: storage() })
    await expect(restored.initialize()).rejects.toThrow('Wallet vault authentication failed')
  })

  it('rejects tampering with encrypted automatic-signing usage authority', async () => {
    const path = await directory()
    const created = new WalletService({ directory: path, platform: 'linux', safeStorage: storage() })
    await created.initialize()
    const generated = await created.generate({
      name: 'Authenticated usage wallet', chainFamily: 'evm', network, workspaceIds: ['workspace-1']
    })
    const policy = await created.setPolicy({
      id: 'policy-usage-authenticated', name: 'One operation', mode: 'bounded-auto', walletId: generated.wallet.id,
      workspaceId: 'workspace-1', networkIds: ['31337'], origins: ['https://dapp.example'],
      destinations: ['0x0000000000000000000000000000000000000002'], methods: ['native-transfer'],
      dailySpendLimit: '1', expiresAt: '2099-08-29T12:00:00.000Z', maximumOperationCount: 1,
      requireSuccessfulSimulation: true, allowMessageSigning: false
    })
    await expect(created.policyUsage.reserve(policy, '1', new Date('2026-08-30T12:00:00.000Z')))
      .resolves.toMatchObject({ reserved: true })
    created.dispose()

    const vaultPath = join(path, 'vault.json')
    const persisted = JSON.parse(await readFile(vaultPath, 'utf8')) as {
      authority: { ciphertext: string }
    }
    persisted.authority.ciphertext = `${persisted.authority.ciphertext.slice(0, -4)}AAAA`
    await writeFile(vaultPath, `${JSON.stringify(persisted, null, 2)}\n`, 'utf8')

    const restored = new WalletService({ directory: path, platform: 'linux', safeStorage: storage() })
    await expect(restored.initialize()).rejects.toThrow('Wallet vault authentication failed')
  })

  it('authenticates the complete managed descriptor before trusting workspace and network authority', async () => {
    const path = await directory()
    const created = new WalletService({ directory: path, platform: 'linux', safeStorage: storage() })
    await created.initialize()
    await created.generate({
      name: 'Descriptor authority wallet', chainFamily: 'evm', network, workspaceIds: ['workspace-1']
    })
    created.dispose()

    const vaultPath = join(path, 'vault.json')
    const persisted = JSON.parse(await readFile(vaultPath, 'utf8')) as {
      wallets: Array<{ workspaceIds: string[]; network: { environment: string } }>
    }
    persisted.wallets[0]!.workspaceIds.push('attacker-workspace')
    persisted.wallets[0]!.network.environment = 'testnet'
    await writeFile(vaultPath, `${JSON.stringify(persisted, null, 2)}\n`, 'utf8')

    const restored = new WalletService({ directory: path, platform: 'linux', safeStorage: storage() })
    await expect(restored.initialize()).rejects.toThrow('Wallet vault authentication failed')
  })

  it('revokes unauthenticated legacy grants and makes legacy automatic policies ask before use', async () => {
    const path = await directory()
    const created = new WalletService({ directory: path, platform: 'linux', safeStorage: storage() })
    await created.initialize()
    const generated = await created.generate({
      name: 'Legacy authority wallet', chainFamily: 'evm', network, workspaceIds: ['workspace-1']
    })
    const policy = await created.setPolicy({
      id: 'legacy-policy', name: 'Legacy allowance', mode: 'bounded-auto', walletId: generated.wallet.id,
      workspaceId: 'workspace-1', networkIds: ['31337'], origins: ['https://dapp.example'],
      destinations: ['0x0000000000000000000000000000000000000002'], methods: ['native-transfer'],
      dailySpendLimit: '1', expiresAt: '2099-08-29T12:00:00.000Z', maximumOperationCount: 1,
      requireSuccessfulSimulation: true, allowMessageSigning: false
    })
    await created.policyUsage.reserve(policy, '1', new Date('2026-08-30T12:00:00.000Z'))
    created.dispose()

    const vaultPath = join(path, 'vault.json')
    const legacyVault = JSON.parse(await readFile(vaultPath, 'utf8')) as { version: number; authority?: unknown }
    legacyVault.version = 1
    delete legacyVault.authority
    await writeFile(vaultPath, `${JSON.stringify(legacyVault, null, 2)}\n`, 'utf8')
    await writeFile(join(path, 'policies.json'), `${JSON.stringify({ version: 1, policies: [
      { ...policy, maxNativeAmount: '1000', maximumOperationCount: 10_000 }
    ] }, null, 2)}\n`, 'utf8')
    await writeFile(join(path, 'permissions.json'), `${JSON.stringify({
      version: 1,
      permissions: [{
        id: 'forged-grant', walletId: generated.wallet.id, workspaceId: 'workspace-1',
        origin: 'https://dapp.example', account: generated.wallet.publicAddress, chainFamily: 'evm',
        networkId: '31337', capabilities: ['read', 'sign', 'send'],
        createdAt: '2026-08-30T12:00:00.000Z', expiresAt: '2099-08-30T12:00:00.000Z'
      }]
    }, null, 2)}\n`, 'utf8')
    await writeFile(join(path, 'policy-usage.json'), `${JSON.stringify({
      version: 1,
      entries: [{ policyId: policy.id, operationCount: 0, dailyDate: '2026-08-30', dailySpend: '0' }]
    }, null, 2)}\n`, 'utf8')

    const restored = new WalletService({ directory: path, platform: 'linux', safeStorage: storage() })
    await restored.initialize()

    expect(restored.policies.list()).toEqual([{ ...policy, maxNativeAmount: '1000', maximumOperationCount: 10_000, mode: 'always-ask' }])
    expect(restored.permissions.list()).toEqual([])
    expect(restored.policyUsage.snapshot(policy.id, new Date('2026-08-30T12:30:00.000Z'))).toMatchObject({
      operationCount: 0,
      dailySpend: '0'
    })
    expect(JSON.parse(await readFile(vaultPath, 'utf8'))).toMatchObject({ version: 2, authority: { algorithm: 'xchacha20-poly1305' } })
  })

  it('rejects a watch-only record that spoofs a managed wallet id', async () => {
    const path = await directory()
    const created = new WalletService({ directory: path, platform: 'linux', safeStorage: storage() })
    await created.initialize()
    const generated = await created.generate({
      name: 'Managed identity', chainFamily: 'evm', network, workspaceIds: ['workspace-1']
    })
    await created.addWatchOnly({
      name: 'Watch identity', chainFamily: 'evm', network,
      publicAddress: '0x0000000000000000000000000000000000000002', workspaceIds: ['workspace-1']
    })
    created.dispose()

    const watchPath = join(path, 'watch-only.json')
    const persisted = JSON.parse(await readFile(watchPath, 'utf8')) as { wallets: Array<{ id: string }> }
    persisted.wallets[0]!.id = generated.wallet.id
    await writeFile(watchPath, `${JSON.stringify(persisted, null, 2)}\n`, 'utf8')

    const restored = new WalletService({ directory: path, platform: 'linux', safeStorage: storage() })
    await expect(restored.initialize()).rejects.toThrow('Wallet identity authentication failed')
  })

  it('releases signing material only through a one-shot current-process authorization', async () => {
    const path = await directory()
    const now = new Date('2026-08-30T12:00:00.000Z')
    const service = new WalletService({ directory: path, platform: 'linux', safeStorage: storage(), now: () => now })
    await service.initialize()
    const generated = await service.generate({
      name: 'Authorized signer', chainFamily: 'evm', network, workspaceIds: ['workspace-1']
    })
    await service.confirmRecovery(generated.wallet.id)
    await service.permissions.grant({
      walletId: generated.wallet.id, workspaceId: 'workspace-1', origin: 'https://dapp.example',
      account: generated.wallet.publicAddress, chainFamily: 'evm', networkId: '31337', capabilities: ['read'],
      requester: { type: 'website', id: 'tab-1' }, expiresAt: '2099-08-30T12:00:00.000Z'
    })
    const request = await service.approvals.create({
      requestId: 'request-authorized-signing', walletId: generated.wallet.id, workspaceId: 'workspace-1',
      tabId: 'tab-1', navigationGeneration: 1, topLevelOrigin: 'https://dapp.example',
      requester: { type: 'website', id: 'tab-1' }, capability: 'sign', chainFamily: 'evm', networkId: '31337',
      operation: 'sign-transaction', payload: { normalized: {} }, expiresAt: '2099-08-30T12:00:00.000Z'
    }, 'authorized-signing', now)
    await service.approvals.transition(request.id, 'validated', now)
    await service.approvals.recordSimulation(request.id, { attempted: true, success: true }, now)
    await service.approvals.transition(request.id, 'simulated', now)
    await service.approvals.transition(request.id, 'policy-decision', now)
    await service.approvals.approve(request.id, request.request, now)

    await expect(service.withSecret(generated.wallet.id, {} as never, async () => true))
      .rejects.toThrow('Wallet signing authorization is invalid or expired')
    const authorization = service.authorizeSigning(request.id)
    await expect(service.withSecret(generated.wallet.id, authorization, async (_wallet, secret) => secret.material.length > 0))
      .resolves.toBe(true)
    await expect(service.withSecret(generated.wallet.id, authorization, async () => true))
      .rejects.toThrow('Wallet signing authorization is invalid or expired')
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
