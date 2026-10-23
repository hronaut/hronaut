import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { withoutContractlessTokenMethods } from '../src/main/wallet/contractless-token-methods.js'
import type { WalletSafeStorage } from '../src/main/wallet/key-provider.js'
import { WalletService } from '../src/main/wallet/service.js'
import { WalletVault } from '../src/main/wallet/vault.js'
import type { WalletPolicy } from '../src/shared/wallet.js'

const temporaryDirectories: string[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

async function directory(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'hronaut-wallet-contractless-test-'))
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
const token = '0x0000000000000000000000000000000000000003'

function policy(overrides: Partial<WalletPolicy>): WalletPolicy {
  return {
    id: 'policy-1', name: 'Local allowance', mode: 'bounded-auto', walletId: 'wallet-1', workspaceId: 'workspace-1',
    networkIds: ['31337'], origins: ['https://dapp.example'], destinations: ['0x0000000000000000000000000000000000000002'],
    methods: ['native-transfer'], expiresAt: '2099-08-29T12:00:00.000Z', maximumOperationCount: 5,
    requireSuccessfulSimulation: true, allowMessageSigning: false,
    ...overrides
  }
}

describe('withoutContractlessTokenMethods', () => {
  it('keeps policies whose methods can still approve something', () => {
    expect(withoutContractlessTokenMethods(policy({}))).toEqual({ action: 'keep' })
    expect(withoutContractlessTokenMethods(policy({ methods: ['erc20.transfer'], contracts: [token] }))).toEqual({ action: 'keep' })
    expect(withoutContractlessTokenMethods(policy({ methods: ['erc20.transfer'], allowAnyTokenContract: true }))).toEqual({ action: 'keep' })
    expect(withoutContractlessTokenMethods(policy({ mode: 'always-ask', methods: ['nft.transferFrom'] }))).toEqual({ action: 'keep' })
  })

  it('removes a policy with only token methods and no token contract', () => {
    expect(withoutContractlessTokenMethods(policy({ methods: ['erc20.approve'] }))).toEqual({ action: 'remove' })
    expect(withoutContractlessTokenMethods(policy({ methods: ['spl.transfer', 'trc20.transfer'] }))).toEqual({ action: 'remove' })
  })

  it('drops only the token methods when the policy still approves something else', () => {
    expect(withoutContractlessTokenMethods(policy({ methods: ['native-transfer', 'erc20.approve'] })))
      .toEqual({ action: 'update', policy: policy({ methods: ['native-transfer'] }) })
    // Website sign-in does not use the methods, so a sign-in policy stays with none, and with no transaction target.
    expect(withoutContractlessTokenMethods(policy({ methods: ['erc20.transfer'], allowWebsiteSignIn: true })))
      .toEqual({ action: 'update', policy: policy({ methods: [], destinations: [], allowWebsiteSignIn: true }) })
    // A mainnet one with Bypass Approve keeps signing in, but no longer claims a Bypass Approve rule it cannot meet.
    const mainnet = policy({
      networkIds: ['1'], methods: ['erc20.transfer'], allowMainnetAgentAutomation: true,
      allowWebsiteSignIn: true, allowMainnetWebsiteSignIn: true
    })
    const cleaned = withoutContractlessTokenMethods(mainnet)
    expect(cleaned).toMatchObject({ action: 'update', policy: { methods: [], destinations: [], allowWebsiteSignIn: true, allowMainnetWebsiteSignIn: true } })
    expect(cleaned.action === 'update' && 'allowMainnetAgentAutomation' in cleaned.policy).toBe(false)
  })
})

describe('WalletService saved policies from 2.45.0 and earlier', () => {
  // 2.45.0 and earlier saved token methods without a token contract, which 2.46.0 began to require. Such a policy
  // stayed in the list, though it could never approve a token call, so every token call still asked for a click.
  async function seed(path: string): Promise<{ walletId: string }> {
    const created = new WalletService({ directory: path, platform: 'linux', safeStorage: storage() })
    await created.initialize()
    const { wallet } = await created.generate({ name: 'Legacy policies', chainFamily: 'evm', network, workspaceIds: ['workspace-1'] })
    for (const entry of [
      policy({ id: 'native', walletId: wallet.id }),
      policy({ id: 'token-only', walletId: wallet.id, methods: ['erc20.approve'], contracts: [token] }),
      policy({ id: 'sign-in', walletId: wallet.id, methods: ['erc20.transfer'], contracts: [token], allowWebsiteSignIn: true })
    ]) await created.setPolicy(entry)
    // Save them as 2.45.0 did, without a token contract, with usage for the token-only one.
    await created.authority.mutate((state) => {
      for (const saved of state.policies) delete saved.contracts
      state.policyUsage.push({ policyId: 'token-only', operationCount: 1, dailyDate: '2026-10-23', dailySpend: '0' })
    })
    created.dispose()
    return { walletId: wallet.id }
  }

  it('removes or narrows them once the vault is ready, with their usage, wallet link and audit entries', async () => {
    const path = await directory()
    const { walletId } = await seed(path)

    const restored = new WalletService({ directory: path, platform: 'linux', safeStorage: storage() })
    await restored.initialize()

    expect(restored.status().managedWallets).toBe('ready')
    expect(restored.policies.list().map((entry) => [entry.id, entry.methods])).toEqual([['native', ['native-transfer']], ['sign-in', []]])
    expect(restored.list().find((wallet) => wallet.id === walletId)?.policyIds.sort()).toEqual(['native', 'sign-in'])
    expect(restored.authority.snapshot().policyUsage).toEqual([])
    const audit = await restored.auditHistory()
    expect(audit).toContainEqual(expect.objectContaining({ type: 'policy-removed', payload: expect.objectContaining({ policyId: 'token-only' }) }))
    expect(audit).toContainEqual(expect.objectContaining({ type: 'policy-updated', payload: expect.objectContaining({ policyId: 'sign-in' }) }))
    restored.dispose()

    const reloaded = new WalletService({ directory: path, platform: 'linux', safeStorage: storage() })
    await reloaded.initialize()
    expect(reloaded.policies.list().map((entry) => entry.id)).toEqual(['native', 'sign-in'])
    reloaded.dispose()
  })

  it('cleans them up when a passphrase vault is unlocked', async () => {
    const path = await directory()
    const service = new WalletService({ directory: path, platform: 'linux', safeStorage: storage('basic_text') })
    await service.initialize()
    await service.setupPassphrase('correct horse battery staple')
    const { wallet } = await service.generate({ name: 'Locked legacy', chainFamily: 'evm', network, workspaceIds: ['workspace-1'] })
    await service.setPolicy(policy({ id: 'token-only', walletId: wallet.id, methods: ['erc20.approve'], contracts: [token] }))
    await service.authority.mutate((state) => {
      for (const saved of state.policies) delete saved.contracts
    })
    service.lock()

    await expect(service.unlock('correct horse battery staple')).resolves.toMatchObject({ managedWallets: 'ready' })

    expect(service.policies.list()).toEqual([])
    expect(service.list().find((entry) => entry.id === wallet.id)?.policyIds).toEqual([])
    service.dispose()
  })

  it('keeps the wallets usable and the policy as saved when the cleanup cannot write', async () => {
    const path = await directory()
    await seed(path)
    vi.spyOn(WalletVault.prototype, 'updateDescriptor').mockRejectedValue(new Error('descriptor write failed'))
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    const restored = new WalletService({ directory: path, platform: 'linux', safeStorage: storage() })
    await restored.initialize()

    expect(restored.status().managedWallets).toBe('ready')
    expect(restored.policies.list().map((entry) => entry.id)).toEqual(['native', 'sign-in', 'token-only'])
    expect(restored.list()[0]?.policyIds).toContain('token-only')
    expect(restored.authority.snapshot().policyUsage.map((entry) => entry.policyId)).toEqual(['token-only'])
    expect(logged).toHaveBeenCalledWith('[wallet] Failed to drop token methods without a token contract from a saved wallet policy')
    restored.dispose()
  })
})
