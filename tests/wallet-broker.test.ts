import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { verifyMessage } from 'viem'
import { WalletBroker, type WalletBrokerContext } from '../src/main/wallet/broker.js'
import type { WalletChainAdapter, WalletNormalizedTransaction } from '../src/main/wallet/adapters/types.js'
import { WalletService } from '../src/main/wallet/service.js'
import type { WalletSafeStorage } from '../src/main/wallet/key-provider.js'
import type { WalletDescriptor, WalletPolicy } from '../src/shared/wallet.js'

const directories: string[] = []
afterEach(async () => {
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

async function setup(environment: 'local' | 'testnet' | 'mainnet' = 'testnet') {
  const directory = await mkdtemp(join(tmpdir(), 'hronaut-wallet-broker-test-'))
  directories.push(directory)
  const service = new WalletService({ directory, platform: 'linux', safeStorage: safeStorage() })
  await service.initialize()
  const generated = await service.generate({
    name: 'Wallet', chainFamily: 'evm',
    network: { id: environment === 'mainnet' ? '1' : '11155111', name: environment, environment, rpcUrl: 'http://127.0.0.1:8545' },
    workspaceIds: ['workspace-1']
  })
  await service.confirmRecovery(generated.wallet.id)
  return { directory, service, wallet: service.list()[0]! }
}

function context(overrides: Partial<WalletBrokerContext> = {}): WalletBrokerContext {
  return {
    workspaceId: 'workspace-1', tabId: 'tab-1', navigationGeneration: 1,
    topLevelOrigin: 'https://dapp.example', requester: { type: 'website', id: 'https://dapp.example' }, ...overrides
  }
}

function adapter(): WalletChainAdapter & { sign: ReturnType<typeof vi.fn>; broadcast: ReturnType<typeof vi.fn> } {
  const sign = vi.fn(async (_wallet: WalletDescriptor, secret: { material: Buffer }) => {
    expect(secret.material.length).toBeGreaterThan(0)
    return 'signed-transaction'
  })
  const broadcast = vi.fn(async () => '0xtransaction')
  return {
    family: 'evm',
    validateAddress: () => true,
    normalizeTransaction: async (wallet): Promise<WalletNormalizedTransaction> => ({
      chainFamily: 'evm', networkId: wallet.network.id, signer: wallet.publicAddress, nonceOrBlockhash: '7',
      raw: { to: '0x0000000000000000000000000000000000000002', value: 1n, nonce: 7n },
      decoded: {
        understood: true,
        destination: '0x0000000000000000000000000000000000000002',
        method: 'native-transfer', nativeAmount: '0.000000000000000001', estimatedFee: '0.000021',
        unlimitedAllowance: false, newContractOrProgram: false, blindMessage: false
      }
    }),
    simulate: async () => ({ attempted: true, success: true, estimatedFee: '0.000021' }),
    sign,
    broadcast,
    confirmation: async () => ({ confirmed: true, failed: false, blockReference: '1' }),
    balance: async () => '1'
  }
}

async function connect(broker: WalletBroker): Promise<void> {
  const result = broker.providerRequest(context(), { family: 'evm', method: 'eth_requestAccounts' })
  await vi.waitFor(() => expect(broker.listPending().some((request) => request.status === 'awaiting-human')).toBe(true))
  const pending = broker.listPending().find((request) => request.status === 'awaiting-human')!
  await broker.approve(pending.id)
  await expect(result).resolves.toHaveLength(1)
}

describe('WalletBroker', () => {
  it('isolates agent address permissions and request status by requester, workspace, and tab', async () => {
    const { service, wallet } = await setup()
    const broker = new WalletBroker(service, { adapters: { evm: adapter() } })
    const agentA = context({ requester: { type: 'agent', id: 'agent-a', name: 'Agent A' } })
    const agentB = context({ requester: { type: 'agent', id: 'agent-b', name: 'Agent B' } })

    expect(broker.listAgentWallets(agentA)).toEqual([
      expect.not.objectContaining({ publicAddress: expect.anything() })
    ])
    const balanceRequest = await broker.agentBalance(agentA, wallet.id)
    expect(balanceRequest).toMatchObject({ status: 'permission-required' })
    expect(JSON.stringify(balanceRequest)).not.toContain(wallet.publicAddress)
    const permissionRequest = (balanceRequest.request as { id: string })
    await broker.approve(permissionRequest.id)

    expect(broker.listAgentWallets(agentA)).toEqual([
      expect.objectContaining({ publicAddress: wallet.publicAddress, addressPermission: true })
    ])
    expect(broker.listAgentWallets(agentB)).toEqual([
      expect.not.objectContaining({ publicAddress: expect.anything() })
    ])
    expect(await broker.agentBalance(agentA, wallet.id)).toMatchObject({ status: 'ready', balance: '1' })

    const prepared = await broker.prepareAgentTransaction(agentA, wallet.id, {
      to: '0x0000000000000000000000000000000000000002'
    })
    expect(prepared).toMatchObject({ status: 'prepared', decoded: { method: 'native-transfer' } })
    expect(prepared).not.toHaveProperty('normalized')
    expect(prepared).not.toHaveProperty('raw')

    const transaction = await broker.requestAgentTransaction(agentA, wallet.id, {
      to: '0x0000000000000000000000000000000000000002'
    }, true)
    const requestId = ((transaction.request as { id: string }).id)
    expect(JSON.stringify(transaction)).not.toContain('"raw"')
    expect(broker.agentRequestStatus(agentA, requestId)).toMatchObject({ id: requestId, status: 'awaiting-human' })
    expect(() => broker.agentRequestStatus(agentB, requestId)).toThrow('not found for this agent')
    await expect(broker.cancelAgentRequest(agentB, requestId)).rejects.toThrow('not found for this agent')
    await expect(broker.cancelAgentRequest(context({
      tabId: 'tab-2', requester: { type: 'agent', id: 'agent-a', name: 'Agent A' }
    }), requestId)).rejects.toThrow('not found for this agent')
    await expect(broker.cancelAgentRequest(agentA, requestId)).resolves.toMatchObject({ status: 'cancelled' })
  })

  it('never lets an agent auto-approve a mainnet request', async () => {
    const { service, wallet } = await setup('mainnet')
    const chain = adapter()
    const broker = new WalletBroker(service, { adapters: { evm: chain } })
    const agent = context({ requester: { type: 'agent', id: 'agent-mainnet', name: 'Agent' } })
    const permission = await broker.agentBalance(agent, wallet.id)
    await broker.approve((permission.request as { id: string }).id)

    const result = await broker.requestAgentTransaction(agent, wallet.id, {
      to: '0x0000000000000000000000000000000000000002'
    }, true)
    expect(result).toMatchObject({ status: 'requested', request: { status: 'awaiting-human' } })
    expect(chain.sign).not.toHaveBeenCalled()
    expect(chain.broadcast).not.toHaveBeenCalled()
  })

  it('keeps pending message contents out of the durable approval store', async () => {
    const { directory, service, wallet } = await setup()
    const broker = new WalletBroker(service, { adapters: { evm: adapter() } })
    const agent = context({ requester: { type: 'agent', id: 'message-agent', name: 'Agent' } })
    const permission = await broker.agentBalance(agent, wallet.id)
    await broker.approve((permission.request as { id: string }).id)

    const message = 'private challenge text that must stay in memory'
    const requested = await broker.requestAgentMessage(agent, wallet.id, Buffer.from(message))
    const requestId = (requested.request as { id: string }).id
    const trustedApproval = broker.listPending().find((request) => request.id === requestId)
    expect(trustedApproval?.details?.raw).toMatchObject({
      message: { encoding: 'base64', value: Buffer.from(message).toString('base64'), utf8Preview: message }
    })
    expect(JSON.stringify(requested)).not.toContain(message)
    expect(JSON.stringify(requested)).not.toContain(Buffer.from(message).toString('base64'))
    const persisted = await readFile(join(directory, 'requests.json'), 'utf8')
    expect(persisted).not.toContain(message)
    expect(persisted).not.toContain(Buffer.from(message).toString('base64'))
    expect(persisted).toContain('messageHash')

    await broker.approve(requestId)
    expect(broker.agentRequestStatus(agent, requestId).status).toBe('confirmed')
  })

  it('keeps addresses private until trusted approval and scopes permission to workspace/origin/account', async () => {
    const { service, wallet } = await setup()
    const events = vi.fn()
    const broker = new WalletBroker(service, { adapters: { evm: adapter() }, onProviderEvent: events })

    await expect(broker.providerRequest(context(), { family: 'evm', method: 'eth_accounts' })).resolves.toEqual([])
    await connect(broker)
    await expect(broker.providerRequest(context(), { family: 'evm', method: 'eth_accounts' }))
      .resolves.toEqual([wallet.publicAddress])
    await expect(broker.providerRequest(context({ topLevelOrigin: 'https://other.example' }), {
      family: 'evm', method: 'eth_accounts'
    })).resolves.toEqual([])
    expect(events).toHaveBeenCalledWith('tab-1', expect.objectContaining({ family: 'evm', event: 'accountsChanged' }))
  })

  it('requires human approval for mainnet even when a bounded automatic policy exists', async () => {
    const { service, wallet } = await setup('mainnet')
    const chain = adapter()
    const broker = new WalletBroker(service, { adapters: { evm: chain } })
    await connect(broker)
    const policy: WalletPolicy = {
      id: 'policy-1', name: 'Must not auto mainnet', mode: 'bounded-auto', walletId: wallet.id,
      workspaceId: 'workspace-1', networkIds: ['1'], origins: ['https://dapp.example'],
      destinations: ['0x0000000000000000000000000000000000000002'], methods: ['native-transfer'],
      maxNativeAmount: '1', maxFee: '1', expiresAt: '2027-08-28T12:00:00.000Z', maximumOperationCount: 10,
      requireSuccessfulSimulation: true, allowMessageSigning: false
    }
    await service.policies.set(policy)

    const result = broker.providerRequest(context(), {
      family: 'evm', method: 'eth_sendTransaction', params: [{ to: policy.destinations[0] }]
    })
    await vi.waitFor(() => expect(broker.listPending().filter((request) => request.operation === 'sign-and-send-transaction').at(-1)?.status)
      .toBe('awaiting-human'))
    expect(chain.sign).not.toHaveBeenCalled()
    const pending = broker.listPending().filter((request) => request.operation === 'sign-and-send-transaction').at(-1)!
    expect(pending.details?.raw).toMatchObject({
      to: '0x0000000000000000000000000000000000000002', value: '1', nonce: '7'
    })
    expect(JSON.stringify(pending.details?.raw)).not.toContain('__hronautWalletType')
    await broker.approve(pending.id)
    await expect(result).resolves.toBe('0xtransaction')
    await vi.waitFor(() => expect(broker.listPending().find((request) => request.id === pending.id)?.status)
      .toBe('confirmed'))
  })

  it('allows a matching bounded testnet policy and rejects mutation/replay through durable request hashes', async () => {
    const { service, wallet } = await setup('testnet')
    const chain = adapter()
    const broker = new WalletBroker(service, { adapters: { evm: chain } })
    await connect(broker)
    await service.policies.set({
      id: 'policy-1', name: 'Testnet transfer', mode: 'bounded-auto', walletId: wallet.id,
      workspaceId: 'workspace-1', networkIds: [wallet.network.id], origins: ['https://dapp.example'],
      destinations: ['0x0000000000000000000000000000000000000002'], methods: ['native-transfer'],
      maxNativeAmount: '1', maxFee: '1', sessionSpendLimit: '2', dailySpendLimit: '3',
      expiresAt: '2027-08-28T12:00:00.000Z', maximumOperationCount: 10,
      requireSuccessfulSimulation: true, allowMessageSigning: false
    })

    await expect(broker.providerRequest(context(), {
      family: 'evm', method: 'eth_sendTransaction', params: [{ to: '0x0000000000000000000000000000000000000002' }]
    })).resolves.toBe('0xtransaction')
    expect(chain.sign).toHaveBeenCalledOnce()
    expect(chain.broadcast).toHaveBeenCalledOnce()
  })

  it('does not let concurrent automatic requests exceed a durable operation limit', async () => {
    const { service, wallet } = await setup('testnet')
    const chain = adapter()
    const broker = new WalletBroker(service, { adapters: { evm: chain } })
    await connect(broker)
    await service.policies.set({
      id: 'policy-one-operation', name: 'One operation only', mode: 'bounded-auto', walletId: wallet.id,
      workspaceId: 'workspace-1', networkIds: [wallet.network.id], origins: ['https://dapp.example'],
      destinations: ['0x0000000000000000000000000000000000000002'], methods: ['native-transfer'],
      maxNativeAmount: '1', maxFee: '1', sessionSpendLimit: '1', dailySpendLimit: '1',
      expiresAt: '2027-08-28T12:00:00.000Z', maximumOperationCount: 1,
      requireSuccessfulSimulation: true, allowMessageSigning: false
    })

    const requests = [0, 1].map(() => broker.providerRequest(context(), {
      family: 'evm' as const,
      method: 'eth_sendTransaction' as const,
      params: [{ to: '0x0000000000000000000000000000000000000002' }]
    }))
    await vi.waitFor(() => expect(broker.listPending().filter((request) => (
      request.operation === 'sign-and-send-transaction' && request.status === 'awaiting-human'
    ))).toHaveLength(1))

    expect(chain.sign).toHaveBeenCalledOnce()
    expect(chain.broadcast).toHaveBeenCalledOnce()
    const awaiting = broker.listPending().find((request) => (
      request.operation === 'sign-and-send-transaction' && request.status === 'awaiting-human'
    ))!
    await broker.reject(awaiting.id)
    const settled = await Promise.allSettled(requests)
    expect(settled.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(settled.filter((result) => result.status === 'rejected')).toHaveLength(1)
  })

  it('cancels a pending website request on navigation and never reaches the signer', async () => {
    const { service } = await setup()
    const chain = adapter()
    const broker = new WalletBroker(service, { adapters: { evm: chain } })
    const result = broker.providerRequest(context(), { family: 'evm', method: 'eth_requestAccounts' })
    await vi.waitFor(() => expect(broker.listPending().some((request) => request.status === 'awaiting-human')).toBe(true))

    await broker.cancelForNavigation('tab-1', 2)

    await expect(result).rejects.toThrow('cancelled')
    expect(chain.sign).not.toHaveBeenCalled()
  })

  it('cancels a pending request when its wallet is detached from the workspace', async () => {
    const { service, wallet } = await setup()
    const chain = adapter()
    const broker = new WalletBroker(service, { adapters: { evm: chain } })
    await broker.updateWallet(wallet.id, { workspaceIds: ['workspace-1', 'workspace-2'] })
    await connect(broker)
    await service.setPolicy({
      id: 'policy-detached-workspace', name: 'Detached workspace automation', mode: 'bounded-auto', walletId: wallet.id,
      workspaceId: 'workspace-1', networkIds: [wallet.network.id], origins: ['https://automation.example'],
      destinations: ['0x0000000000000000000000000000000000000002'], methods: ['native-transfer'],
      maxNativeAmount: '1', maxFee: '1', expiresAt: '2027-08-28T12:00:00.000Z', maximumOperationCount: 10,
      requireSuccessfulSimulation: true, allowMessageSigning: false
    })
    await service.setPolicy({
      id: 'policy-retained-workspace', name: 'Retained workspace automation', mode: 'bounded-auto', walletId: wallet.id,
      workspaceId: 'workspace-2', networkIds: [wallet.network.id], origins: ['https://automation.example'],
      destinations: ['0x0000000000000000000000000000000000000002'], methods: ['native-transfer'],
      maxNativeAmount: '1', maxFee: '1', expiresAt: '2027-08-28T12:00:00.000Z', maximumOperationCount: 10,
      requireSuccessfulSimulation: true, allowMessageSigning: false
    })
    const result = broker.providerRequest(context(), {
      family: 'evm', method: 'eth_signTransaction',
      params: [{ to: '0x0000000000000000000000000000000000000002' }]
    })
    await vi.waitFor(() => expect(broker.listPending().filter((request) => request.operation === 'sign-transaction').at(-1)?.status)
      .toBe('awaiting-human'))

    await broker.updateWallet(wallet.id, { workspaceIds: ['workspace-2'] })

    await expect(result).rejects.toThrow('cancelled')
    expect(service.list()[0]?.workspaceIds).toEqual(['workspace-2'])
    expect(service.list()[0]?.policyIds).toEqual(['policy-retained-workspace'])
    expect(service.policies.list(wallet.id)).toEqual([
      expect.objectContaining({ id: 'policy-retained-workspace', workspaceId: 'workspace-2' })
    ])
    expect(service.permissions.list()).toHaveLength(0)
    expect(chain.sign).not.toHaveBeenCalled()
  })

  it('cancels only matching pending requests when their address permission is revoked', async () => {
    const { service, wallet } = await setup()
    const chain = adapter()
    const broker = new WalletBroker(service, { adapters: { evm: chain } })
    await connect(broker)
    const permission = service.permissions.list()[0]!
    const result = broker.providerRequest(context(), {
      family: 'evm', method: 'personal_sign', params: ['permission-revoked', wallet.publicAddress]
    })
    await vi.waitFor(() => expect(broker.listPending().filter((request) => request.operation === 'sign-message').at(-1)?.status)
      .toBe('awaiting-human'))

    await expect(broker.revokePermission(permission.id)).resolves.toBe(true)

    await expect(result).rejects.toThrow('cancelled')
    expect(service.permissions.list()).toHaveLength(0)
    expect(chain.sign).not.toHaveBeenCalled()
  })

  it('rejects a live provider waiter and clears message details when its wallet is removed', async () => {
    const { service, wallet } = await setup()
    const broker = new WalletBroker(service, { adapters: { evm: adapter() } })
    await connect(broker)
    const result = broker.providerRequest(context(), {
      family: 'evm', method: 'personal_sign', params: ['remove-pending-wallet', wallet.publicAddress]
    })
    await vi.waitFor(() => expect(broker.listPending().filter((request) => request.operation === 'sign-message').at(-1)?.details?.raw)
      .toHaveProperty('message'))

    await expect(broker.removeWallet(wallet.id)).resolves.toBe(true)

    await expect(result).rejects.toThrow('cancelled')
    expect(service.list()).toHaveLength(0)
    expect(broker.listPending().filter((request) => request.walletId === wallet.id).at(-1)).toMatchObject({
      status: 'cancelled'
    })
    expect(broker.listPending().filter((request) => request.walletId === wallet.id).at(-1)).not.toHaveProperty('details.raw.message')
  })

  it('expires the waiting caller when trusted approval arrives after request expiry', async () => {
    const { service } = await setup()
    let now = new Date('2026-08-28T12:00:00.000Z')
    const broker = new WalletBroker(service, { adapters: { evm: adapter() }, now: () => now })
    const result = broker.providerRequest(context(), { family: 'evm', method: 'eth_requestAccounts' })
    await vi.waitFor(() => expect(broker.listPending().find((request) => request.status === 'awaiting-human')).toBeDefined())
    const pending = broker.listPending().find((request) => request.status === 'awaiting-human')!
    now = new Date('2026-08-28T12:06:00.000Z')

    await expect(broker.approve(pending.id)).rejects.toThrow('expired')
    await expect(Promise.race([
      result,
      new Promise((resolve) => setTimeout(() => resolve('still-pending'), 20))
    ])).rejects.toThrow('expired')
    expect(broker.listPending().find((request) => request.id === pending.id)?.status).toBe('expired')
  })

  it('always routes message signing through trusted human approval and validates the requested account', async () => {
    const { service, wallet } = await setup('testnet')
    const broker = new WalletBroker(service, { adapters: { evm: adapter() } })
    await connect(broker)
    await expect(broker.providerRequest(context(), {
      family: 'evm', method: 'personal_sign', params: ['0x68656c6c6f', '0x0000000000000000000000000000000000000001']
    })).rejects.toThrow('signer does not match')

    const result = broker.providerRequest(context(), {
      family: 'evm', method: 'personal_sign', params: ['0x68656c6c6f', wallet.publicAddress]
    })
    await vi.waitFor(() => expect(broker.listPending().filter((request) => request.operation === 'sign-message').at(-1)?.status)
      .toBe('awaiting-human'))
    const pending = broker.listPending().filter((request) => request.operation === 'sign-message').at(-1)!
    await broker.approve(pending.id)
    const signature = await result as `0x${string}`
    await expect(verifyMessage({ address: wallet.publicAddress as `0x${string}`, message: { raw: '0x68656c6c6f' }, signature }))
      .resolves.toBe(true)
  })
})
