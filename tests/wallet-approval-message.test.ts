import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { WalletBroker, type WalletBrokerContext } from '../src/main/wallet/broker.js'
import { WalletService } from '../src/main/wallet/service.js'
import type { WalletSafeStorage } from '../src/main/wallet/key-provider.js'
import type { WalletDescriptor } from '../src/shared/wallet.js'

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

const context: WalletBrokerContext = {
  workspaceId: 'workspace-1', tabId: 'tab-1', navigationGeneration: 1,
  topLevelOrigin: 'https://dapp.example', requester: { type: 'website', id: 'https://dapp.example' }
}

// A connected Sepolia wallet, so personal_sign goes straight to a person.
async function connectedWallet() {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(now())
  onTestFinished(() => { vi.useRealTimers() })
  const directory = await mkdtemp(join(tmpdir(), 'hronaut-wallet-approval-message-'))
  directories.push(directory)
  const service = new WalletService({ directory, platform: 'linux', safeStorage: safeStorage(), now })
  await service.initialize()
  const generated = await service.generate({
    name: 'Wallet', chainFamily: 'evm',
    network: { id: '11155111', name: 'Sepolia', environment: 'testnet', rpcUrl: 'http://127.0.0.1:8545' },
    workspaceIds: ['workspace-1'], dedicatedAgent: false
  })
  await service.confirmRecovery(generated.wallet.id)
  const broker = new WalletBroker(service, { now, requestExpiryScheduler: () => () => {} })
  brokers.push(broker)
  const connecting = broker.providerRequest(context, { family: 'evm', method: 'eth_requestAccounts' })
  await vi.waitFor(() => expect(broker.listPending().some((request) => request.status === 'awaiting-human')).toBe(true))
  await broker.approve(broker.listPending().find((request) => request.status === 'awaiting-human')!.id)
  await connecting
  return { broker, wallet: service.list()[0]! }
}

async function pendingMessage(broker: WalletBroker, wallet: WalletDescriptor, message: string) {
  const signing = broker.providerRequest(context, { family: 'evm', method: 'personal_sign', params: [message, wallet.publicAddress] })
  signing.catch(() => undefined)
  await vi.waitFor(() => expect(broker.listPending().some((request) => request.status === 'awaiting-human')).toBe(true))
  const pending = broker.listPending().find((request) => request.status === 'awaiting-human')!
  return { pending, settle: () => broker.reject(pending.id) }
}

function siwe(wallet: WalletDescriptor, domain = 'dapp.example', address = wallet.publicAddress, chain = wallet.network.id): string {
  return [
    `${domain} wants you to sign in with your Ethereum account:`, address, '', 'Sign in to Dapp.', '',
    `URI: https://${domain}`, 'Version: 1', `Chain ID: ${chain}`, 'Nonce: 32891756', 'Issued At: 2026-09-04T12:00:00.000Z'
  ].join('\n')
}

describe('message text in the trusted approval', () => {
  it('shows a plain-text message as readable text without the undecodable warning', async () => {
    const { broker, wallet } = await connectedWallet()
    const message = siwe(wallet)
    const { pending, settle } = await pendingMessage(broker, wallet, message)

    expect(pending.details?.message).toEqual({ text: message, warnings: [] })
    expect(pending.details?.understood).toBe(true)
    expect(pending.details?.method).toBe('message-signing')
    await settle()
  })

  it.each([
    ['another site', (wallet: WalletDescriptor) => siwe(wallet, 'phishing.example'), 'sign-in-other-site'],
    ['another account', (wallet: WalletDescriptor) => siwe(wallet, 'dapp.example', '0x0000000000000000000000000000000000000001'), 'sign-in-other-account'],
    ['another chain', (wallet: WalletDescriptor) => siwe(wallet, 'dapp.example', wallet.publicAddress, '1'), 'sign-in-other-chain'],
    ['no address line', () => 'dapp.example wants you to sign in with your Ethereum account:\nSign in to Dapp.', 'sign-in-unverified']
  ] as const)('warns when sign-in text names %s', async (_label, build, warning) => {
    const { broker, wallet } = await connectedWallet()
    const { pending, settle } = await pendingMessage(broker, wallet, build(wallet))

    expect(pending.details?.message?.warnings).toEqual([warning])
    await settle()
  })

  it('reveals hidden and direction-changing characters and keeps the undecodable warning', async () => {
    const { broker, wallet } = await connectedWallet()
    const { pending, settle } = await pendingMessage(broker, wallet, 'Pay ‮evil‬ to​ me\r\n')

    expect(pending.details?.message).toEqual({
      text: 'Pay [U+202E]evil[U+202C] to[U+200B] me[U+000D]\n',
      warnings: ['hidden-characters']
    })
    expect(pending.details?.understood).toBe(false)
    await settle()
  })

  it('truncates long text for display and keeps the full message in the raw request', async () => {
    const { broker, wallet } = await connectedWallet()
    const { pending, settle } = await pendingMessage(broker, wallet, 'a'.repeat(5_000))

    expect(pending.details?.message?.text).toHaveLength(4_096)
    expect(pending.details?.message?.truncated).toBe(true)
    expect(pending.details?.understood).toBe(false)
    const raw = pending.details?.raw as { message: { value: string } }
    expect(Buffer.from(raw.message.value, 'base64').toString('utf8')).toHaveLength(5_000)
    await settle()
  })

  it('shows no text for binary messages', async () => {
    const { broker, wallet } = await connectedWallet()
    const { pending, settle } = await pendingMessage(broker, wallet, '0xff00fe')

    expect(pending.details?.message).toBeUndefined()
    expect(pending.details?.understood).toBe(false)
    await settle()
  })
})
