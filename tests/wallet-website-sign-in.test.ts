import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { verifyMessage } from 'viem'
import { WalletBroker, type WalletBrokerContext } from '../src/main/wallet/broker.js'
import { WalletService } from '../src/main/wallet/service.js'
import type { WalletSafeStorage } from '../src/main/wallet/key-provider.js'
import type { WalletDescriptor, WalletPolicy } from '../src/shared/wallet.js'

const directories: string[] = []
const brokers: WalletBroker[] = []
const now = () => new Date('2026-09-04T12:00:00.000Z')

afterEach(async () => {
  await Promise.all(brokers.splice(0).map((broker) => broker.shutdown()))
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

function safeStorage(): WalletSafeStorage {
  return {
    isEncryptionAvailable: () => true,
    isAsyncEncryptionAvailable: async () => true,
    getSelectedStorageBackend: () => 'gnome_libsecret',
    encryptStringAsync: async (value) => Buffer.from(`safe:${value}`),
    decryptStringAsync: async (value) => ({ result: value.toString().replace(/^safe:/, ''), shouldReEncrypt: false })
  }
}

async function setup(environment: 'testnet' | 'mainnet' = 'testnet', dedicatedAgent = false) {
  // Keep the permission store's wall clock aligned with the injected broker clock.
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(now())
  onTestFinished(() => { vi.useRealTimers() })
  const directory = await mkdtemp(join(tmpdir(), 'hronaut-wallet-sign-in-test-'))
  directories.push(directory)
  const service = new WalletService({ directory, platform: 'linux', safeStorage: safeStorage(), now })
  await service.initialize()
  const generated = await service.generate({
    name: 'Wallet', chainFamily: 'evm',
    network: { id: environment === 'mainnet' ? '1' : '11155111', name: environment, environment, rpcUrl: 'http://127.0.0.1:8545' },
    workspaceIds: ['workspace-1'], dedicatedAgent
  })
  await service.confirmRecovery(generated.wallet.id)
  const broker = new WalletBroker(service, { now, requestExpiryScheduler: () => () => {} })
  brokers.push(broker)
  return { service, broker, wallet: service.list()[0]! }
}

function context(overrides: Partial<WalletBrokerContext> = {}): WalletBrokerContext {
  return {
    workspaceId: 'workspace-1', tabId: 'tab-1', navigationGeneration: 1,
    topLevelOrigin: 'https://dapp.example', requester: { type: 'website', id: 'https://dapp.example' }, ...overrides
  }
}

function signInPolicy(wallet: WalletDescriptor, overrides: Partial<WalletPolicy> = {}): WalletPolicy {
  return {
    id: 'sign-in', name: 'Sign-in', mode: 'bounded-auto', walletId: wallet.id, workspaceId: 'workspace-1',
    networkIds: [wallet.network.id], origins: ['https://dapp.example'], destinations: [], methods: [],
    expiresAt: '2026-09-05T12:00:00.000Z', maximumOperationCount: 10,
    requireSuccessfulSimulation: true, allowMessageSigning: false, allowWebsiteSignIn: true, ...overrides
  }
}

function siwe(wallet: WalletDescriptor, domain = 'dapp.example', chain = wallet.network.id): string {
  return [
    `${domain} wants you to sign in with your Ethereum account:`, wallet.publicAddress, '', 'Sign in to Dapp.', '',
    'URI: https://dapp.example', 'Version: 1', `Chain ID: ${chain}`, 'Nonce: 32891756', 'Issued At: 2026-09-04T12:00:00.000Z'
  ].join('\n')
}

const connectAccount = (broker: WalletBroker, overrides: Partial<WalletBrokerContext> = {}) => (
  broker.providerRequest(context(overrides), { family: 'evm', method: 'eth_requestAccounts' })
)
const personalSign = (broker: WalletBroker, wallet: WalletDescriptor, message: string) => (
  broker.providerRequest(context(), { family: 'evm', method: 'personal_sign', params: [message, wallet.publicAddress] })
)

function settle<T>(promise: Promise<T>): Promise<{ status: 'fulfilled'; value: T } | { status: 'rejected'; reason: unknown }> {
  return promise.then((value) => ({ status: 'fulfilled' as const, value }), (reason: unknown) => ({ status: 'rejected' as const, reason }))
}

async function awaitingHuman(broker: WalletBroker) {
  await vi.waitFor(() => expect(broker.listPending().some((request) => request.status === 'awaiting-human')).toBe(true))
  return broker.listPending().find((request) => request.status === 'awaiting-human')!
}

describe('website sign-in without a click', () => {
  it('connects and signs plain-text sign-in messages for the allowed testnet site, counting each operation', async () => {
    const { service, broker, wallet } = await setup()
    await service.setPolicy(signInPolicy(wallet))

    await expect(connectAccount(broker)).resolves.toEqual([wallet.publicAddress])
    const message = siwe(wallet)
    const signature = await personalSign(broker, wallet, message) as `0x${string}`
    await expect(verifyMessage({ address: wallet.publicAddress as `0x${string}`, message, signature })).resolves.toBe(true)
    const plain = await personalSign(broker, wallet, 'Log in to Dapp: nonce 42') as `0x${string}`
    await expect(verifyMessage({ address: wallet.publicAddress as `0x${string}`, message: 'Log in to Dapp: nonce 42', signature: plain })).resolves.toBe(true)

    expect(broker.listPending().filter((request) => request.status === 'awaiting-human')).toEqual([])
    expect(service.policyUsage.snapshot('sign-in', now()).operationCount).toBe(3)
    const audit = await service.auditHistory()
    expect(audit.filter((entry) => entry.type === 'request-approved-by-policy')).toHaveLength(3)
    // Access granted by the policy ends with the policy rather than after 30 days.
    expect(service.permissions.list()).toEqual([expect.objectContaining({ origin: 'https://dapp.example', expiresAt: '2026-09-05T12:00:00.000Z' })])
  })

  it('keeps other sites, typed data, raw signing, binary and mismatched sign-in messages with a person', async () => {
    const { service, broker, wallet } = await setup()
    await service.setPolicy(signInPolicy(wallet))
    await connectAccount(broker)

    const otherSite = settle(connectAccount(broker, { tabId: 'tab-2', topLevelOrigin: 'https://other.example', requester: { type: 'website', id: 'https://other.example' } }))
    const otherPending = await awaitingHuman(broker)
    expect(otherPending).toMatchObject({ operation: 'connect-account', origin: 'https://other.example' })
    await broker.reject(otherPending.id)
    expect(await otherSite).toMatchObject({ status: 'rejected' })

    const cases: [string, () => Promise<unknown>][] = [
      ['typed data', () => broker.providerRequest(context(), {
        family: 'evm', method: 'eth_signTypedData_v4', params: [wallet.publicAddress, JSON.stringify({
          domain: { name: 'Dapp', chainId: 11155111 }, primaryType: 'Login',
          types: { EIP712Domain: [{ name: 'name', type: 'string' }, { name: 'chainId', type: 'uint256' }], Login: [{ name: 'nonce', type: 'uint256' }] },
          message: { nonce: 1 }
        })]
      })],
      ['eth_sign', () => broker.providerRequest(context(), { family: 'evm', method: 'eth_sign', params: [wallet.publicAddress, `0x${'ab'.repeat(32)}`] })],
      ['a binary hash', () => personalSign(broker, wallet, `0x${'de'.repeat(32)}`)],
      ['another site in the sign-in text', () => personalSign(broker, wallet, siwe(wallet, 'bank.example'))],
      ['another chain in the sign-in text', () => personalSign(broker, wallet, siwe(wallet, 'dapp.example', '1'))]
    ]
    for (const [name, request] of cases) {
      const result = settle(request())
      const pending = await awaitingHuman(broker)
      expect(pending, name).toMatchObject({ operation: 'sign-message' })
      await broker.reject(pending.id)
      expect(await result, name).toMatchObject({ status: 'rejected', reason: expect.objectContaining({ message: expect.stringMatching(/rejected/) }) })
    }
    expect(service.policyUsage.snapshot('sign-in', now()).operationCount).toBe(1)
  })

  it('asks a person once the operation limit is reached', async () => {
    const { service, broker, wallet } = await setup()
    await service.setPolicy(signInPolicy(wallet, { maximumOperationCount: 1 }))
    await connectAccount(broker)
    const signing = personalSign(broker, wallet, 'Log in to Dapp')
    const pending = await awaitingHuman(broker)
    expect(pending).toMatchObject({ operation: 'sign-message' })
    await broker.approve(pending.id)
    await expect(signing).resolves.toMatch(/^0x/)
  })

  it('returns the request to a person when the policy is removed after its decision', async () => {
    const { service, broker, wallet } = await setup()
    await service.setPolicy(signInPolicy(wallet))
    const reserve = service.policyUsage.reserve.bind(service.policyUsage)
    vi.spyOn(service.policyUsage, 'reserve').mockImplementationOnce(async (...args) => {
      const reservation = await reserve(...args)
      await service.removePolicy('sign-in')
      return reservation
    })
    const connecting = connectAccount(broker)
    const pending = await awaitingHuman(broker)
    expect(pending).toMatchObject({ operation: 'connect-account' })
    expect((await service.auditHistory()).map((entry) => entry.type)).toContain('policy-authorization-invalidated')
    await broker.approve(pending.id)
    await expect(connecting).resolves.toEqual([wallet.publicAddress])
  })

  it('validates the testnet and separate mainnet switches when saving a policy', async () => {
    const testnet = await setup()
    await expect(testnet.service.setPolicy(signInPolicy(testnet.wallet, { allowMainnetWebsiteSignIn: true })))
      .rejects.toThrow('only valid for a mainnet wallet')
    await expect(testnet.service.setPolicy(signInPolicy(testnet.wallet, { allowWebsiteSignIn: false, allowMainnetWebsiteSignIn: true })))
      .rejects.toThrow('requires website sign-in')
    await expect(testnet.service.setPolicy(signInPolicy(testnet.wallet, { mode: 'always-ask' })))
      .rejects.toThrow('requires a bounded automatic policy')
    await expect(testnet.service.setPolicy(signInPolicy(testnet.wallet, { origins: [] })))
      .rejects.toThrow('requires an allowed website origin')

    const mainnet = await setup('mainnet', true)
    await expect(mainnet.service.setPolicy(signInPolicy(mainnet.wallet)))
      .rejects.toThrow('separate mainnet switch')
    await expect(mainnet.service.setPolicy(signInPolicy(mainnet.wallet, { allowMainnetWebsiteSignIn: true, maximumOperationCount: 101 })))
      .rejects.toThrow('at most 100 operations')
    await expect(mainnet.service.setPolicy(signInPolicy(mainnet.wallet, { allowMainnetWebsiteSignIn: true, expiresAt: '2026-09-11T12:00:00.001Z' })))
      .rejects.toThrow('expiry within 7 days')
    await expect(mainnet.service.setPolicy(signInPolicy(mainnet.wallet, {
      allowMainnetWebsiteSignIn: true, destinations: ['0x0000000000000000000000000000000000000002'], methods: ['native-transfer']
    }))).rejects.toThrow('cannot list transaction destinations')
  })

  it('refuses mainnet sign-in on an ordinary mainnet wallet', async () => {
    const { service, wallet } = await setup('mainnet', false)
    await expect(service.setPolicy(signInPolicy(wallet, { allowMainnetWebsiteSignIn: true })))
      .rejects.toThrow('dedicated EVM agent wallet')
  })

  it('connects and signs on mainnet only with the separate mainnet switch on a dedicated agent wallet', async () => {
    const { service, broker, wallet } = await setup('mainnet', true)
    await service.setPolicy(signInPolicy(wallet, { allowMainnetWebsiteSignIn: true }))
    await expect(connectAccount(broker)).resolves.toEqual([wallet.publicAddress])
    const message = siwe(wallet)
    const signature = await personalSign(broker, wallet, message) as `0x${string}`
    await expect(verifyMessage({ address: wallet.publicAddress as `0x${string}`, message, signature })).resolves.toBe(true)
    expect(service.policyUsage.snapshot('sign-in', now()).operationCount).toBe(2)
  })
})
