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

  it('shows default-ignorable characters such as Hangul fillers and variation selectors as codes', async () => {
    const { broker, wallet } = await connectedWallet()
    const { pending, settle } = await pendingMessage(broker, wallet, 'Hi\u3164there\uFE0F\u2800')

    expect(pending.details?.message).toEqual({ text: 'Hi[U+3164]there[U+FE0F][U+2800]', warnings: ['hidden-characters'] })
    await settle()
  })

  it.each([
    ['a revealed code', 'a'.repeat(4_090) + '\u200B'],
    ['a surrogate pair', 'a'.repeat(4_095) + '\u{1F600}']
  ])('cuts the shown text before %s rather than through it', async (_label, message) => {
    const { broker, wallet } = await connectedWallet()
    const { pending, settle } = await pendingMessage(broker, wallet, message)

    expect(pending.details?.message?.text).toBe('a'.repeat(message.length - (message.endsWith('\u200B') ? 1 : 2)))
    expect(pending.details?.message?.truncated).toBe(true)
    await settle()
  })

  it('summarizes a typed-data token permit and keeps it out of what agents see', async () => {
    const { broker, wallet } = await connectedWallet()
    const spender = '0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD'
    const signing = broker.providerRequest(context, {
      family: 'evm', method: 'eth_signTypedData_v4', params: [wallet.publicAddress, JSON.stringify({
        domain: { name: 'Permit2', chainId: 1, verifyingContract: '0x000000000022D473030F116dDEE9F6B43aC78BA3' },
        primaryType: 'PermitSingle',
        types: {
          EIP712Domain: [{ name: 'name', type: 'string' }, { name: 'chainId', type: 'uint256' }, { name: 'verifyingContract', type: 'address' }],
          PermitSingle: [{ name: 'details', type: 'PermitDetails' }, { name: 'spender', type: 'address' }, { name: 'sigDeadline', type: 'uint256' }],
          PermitDetails: [{ name: 'token', type: 'address' }, { name: 'amount', type: 'uint160' }, { name: 'expiration', type: 'uint48' }, { name: 'nonce', type: 'uint48' }]
        },
        message: { details: { token: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238', amount: (2n ** 160n - 1n).toString(), expiration: 0, nonce: 0 }, spender, sigDeadline: 0 }
      })]
    })
    signing.catch(() => undefined)
    await vi.waitFor(() => expect(broker.listPending().some((request) => request.operation === 'sign-message')).toBe(true))
    const pending = broker.listPending().find((request) => request.operation === 'sign-message')!

    expect(pending.details?.typedData).toMatchObject({
      primaryType: 'PermitSingle',
      domain: { name: 'Permit2', chainId: '1' },
      tokenAccess: { spender, allowances: [{ unlimited: true }] },
      warnings: ['typed-data-other-chain', 'token-permit', 'unlimited-amount']
    })
    expect(pending.details?.message).toBeUndefined()
    const agentView = JSON.stringify(broker.agentPageRequests({ ...context, requester: { type: 'agent', id: 'agent-1' } }))
    expect(agentView).toContain('typed-data-signing')
    expect(agentView).not.toContain(spender)
    expect(agentView).not.toContain('typedData')
    await broker.reject(pending.id)
  })

  it('does not let undeclared keys or an array amount hide an unlimited permit', async () => {
    const { broker, wallet } = await connectedWallet()
    const token = '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238'
    const maxUint256 = (2n ** 256n - 1n).toString()
    // The signer ignores `allowed`, which this permit type does not declare, and reads ['max'] as max.
    const signing = broker.providerRequest(context, {
      family: 'evm', method: 'eth_signTypedData_v4', params: [wallet.publicAddress, JSON.stringify({
        domain: { name: 'USD Coin', version: '2', chainId: Number(wallet.network.id), verifyingContract: token },
        primaryType: 'Permit',
        types: {
          EIP712Domain: [{ name: 'name', type: 'string' }, { name: 'version', type: 'string' }, { name: 'chainId', type: 'uint256' }, { name: 'verifyingContract', type: 'address' }],
          Permit: [
            { name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }, { name: 'value', type: 'uint256' },
            { name: 'nonce', type: 'uint256' }, { name: 'deadline', type: 'uint256' }
          ]
        },
        message: { owner: wallet.publicAddress, spender: token, value: [maxUint256], nonce: 0, deadline: 0, allowed: false }
      })]
    })
    signing.catch(() => undefined)
    await vi.waitFor(() => expect(broker.listPending().some((request) => request.operation === 'sign-message')).toBe(true))
    const pending = broker.listPending().find((request) => request.operation === 'sign-message')!

    expect(pending.details?.typedData?.tokenAccess?.allowances).toEqual([{ token, amount: maxUint256, unlimited: true }])
    expect(pending.details?.typedData?.warnings).toEqual(['token-permit', 'unlimited-amount'])
    await broker.reject(pending.id)
  })

  it('keeps message text out of what agents see', async () => {
    const { broker, wallet } = await connectedWallet()
    const { settle } = await pendingMessage(broker, wallet, siwe(wallet))

    const agentView = JSON.stringify(broker.agentPageRequests({ ...context, requester: { type: 'agent', id: 'agent-1' } }))
    expect(agentView).toContain('message-signing')
    expect(agentView).not.toContain('wants you to sign in')
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

describe('Sign-In with Solana text in the trusted approval', () => {
  async function connectedSolanaWallet() {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(now())
    onTestFinished(() => { vi.useRealTimers() })
    const directory = await mkdtemp(join(tmpdir(), 'hronaut-wallet-approval-solana-'))
    directories.push(directory)
    const service = new WalletService({ directory, platform: 'linux', safeStorage: safeStorage(), now })
    await service.initialize()
    const generated = await service.generate({
      name: 'Solana wallet', chainFamily: 'solana',
      network: { id: 'devnet', name: 'Devnet', environment: 'testnet', rpcUrl: 'http://127.0.0.1:8899' },
      workspaceIds: ['workspace-1'], dedicatedAgent: false
    })
    const wallet = await service.confirmRecovery(generated.wallet.id)
    const broker = new WalletBroker(service, { now, requestExpiryScheduler: () => () => {} })
    brokers.push(broker)
    const connecting = broker.providerRequest(context, { family: 'solana', method: 'connect' })
    await vi.waitFor(() => expect(broker.listPending().some((request) => request.status === 'awaiting-human')).toBe(true))
    await broker.approve(broker.listPending().find((request) => request.status === 'awaiting-human')!.id)
    await connecting
    return { broker, wallet }
  }

  it.each([
    ['dapp.example', [] as string[]],
    ['phishing.example', ['sign-in-other-site']]
  ])('checks the site a Solana sign-in for %s names', async (domain, warnings) => {
    const { broker, wallet } = await connectedSolanaWallet()
    const message = `${domain} wants you to sign in with your Solana account:\n${wallet.publicAddress}\n\nSign in.`
    const signing = broker.providerRequest(context, {
      family: 'solana', method: 'signMessage',
      params: [{ account: { address: wallet.publicAddress }, message: new TextEncoder().encode(message) }]
    })
    signing.catch(() => undefined)
    await vi.waitFor(() => expect(broker.listPending().some((request) => request.operation === 'sign-message')).toBe(true))
    const pending = broker.listPending().find((request) => request.operation === 'sign-message')!

    expect(pending.details?.message).toEqual({ text: message, warnings })
    await broker.reject(pending.id)
  })
})
