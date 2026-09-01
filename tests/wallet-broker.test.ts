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

async function setup(environment: 'local' | 'testnet' | 'mainnet' = 'testnet', dedicatedAgent = false) {
  const directory = await mkdtemp(join(tmpdir(), 'hronaut-wallet-broker-test-'))
  directories.push(directory)
  const service = new WalletService({ directory, platform: 'linux', safeStorage: safeStorage() })
  await service.initialize()
  const generated = await service.generate({
    name: 'Wallet', chainFamily: 'evm',
    network: { id: environment === 'mainnet' ? '1' : '11155111', name: environment, environment, rpcUrl: 'http://127.0.0.1:8545' },
    workspaceIds: ['workspace-1'], dedicatedAgent
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

function settle<T>(promise: Promise<T>): Promise<
  { status: 'fulfilled'; value: T } | { status: 'rejected'; reason: unknown }
> {
  return promise.then(
    (value) => ({ status: 'fulfilled' as const, value }),
    (reason: unknown) => ({ status: 'rejected' as const, reason })
  )
}

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })
  return { promise, resolve, reject }
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
  it('keeps wallet RPC endpoints and embedded credentials out of agent descriptors', async () => {
    const { service } = await setup()
    await service.addWatchOnly({
      name: 'Credentialed endpoint',
      chainFamily: 'evm',
      publicAddress: '0x0000000000000000000000000000000000000002',
      network: {
        id: '8453',
        name: 'Base',
        environment: 'mainnet',
        rpcUrl: 'https://rpc-user:rpc-password@rpc.example.invalid/v1?apiKey=rpc-query-secret'
      },
      workspaceIds: ['workspace-1']
    })
    const broker = new WalletBroker(service, { adapters: { evm: adapter() } })

    const listed = broker.listAgentWallets(context({
      requester: { type: 'agent', id: 'agent-rpc-redaction', name: 'RPC redaction agent' }
    }))
    expect(listed).toContainEqual(expect.objectContaining({
      name: 'Credentialed endpoint',
      network: { id: '8453', name: 'Base', environment: 'mainnet' }
    }))
    expect(JSON.stringify(listed)).not.toMatch(/rpcUrl|rpc-user|rpc-password|rpc-query-secret/)
  })

  it('keeps RPC failure details out of agent balance errors', async () => {
    const { service, wallet } = await setup()
    const agent = context({ requester: { type: 'agent', id: 'agent-rpc-error', name: 'RPC error agent' } })
    await service.permissions.grant({
      walletId: wallet.id,
      workspaceId: agent.workspaceId,
      origin: agent.topLevelOrigin,
      frameOrigin: agent.topLevelOrigin,
      account: wallet.publicAddress,
      chainFamily: wallet.chainFamily,
      networkId: wallet.network.id,
      capabilities: ['read'],
      requester: agent.requester,
      expiresAt: new Date(Date.now() + 60_000).toISOString()
    })
    const chain = adapter()
    chain.balance = vi.fn(async () => {
      throw new Error('RPC https://rpc-user:rpc-password@rpc.example.invalid/v1?apiKey=rpc-query-secret failed')
    })
    const broker = new WalletBroker(service, { adapters: { evm: chain } })

    const result = await settle(broker.agentBalance(agent, wallet.id))
    expect(result).toMatchObject({
      status: 'rejected',
      reason: expect.objectContaining({ message: 'EVM balance lookup failed' })
    })
    expect(JSON.stringify(result)).not.toMatch(/rpc\.example|rpc-user|rpc-password|rpc-query-secret/)
  })

  it('keeps RPC simulation details out of agent responses and durable approval state', async () => {
    const { directory, service, wallet } = await setup()
    const agent = context({ requester: { type: 'agent', id: 'agent-simulation-error', name: 'Simulation error agent' } })
    await service.permissions.grant({
      walletId: wallet.id,
      workspaceId: agent.workspaceId,
      origin: agent.topLevelOrigin,
      frameOrigin: agent.topLevelOrigin,
      account: wallet.publicAddress,
      chainFamily: wallet.chainFamily,
      networkId: wallet.network.id,
      capabilities: ['read'],
      requester: agent.requester,
      expiresAt: new Date(Date.now() + 60_000).toISOString()
    })
    const chain = adapter()
    chain.simulate = vi.fn(async () => ({
      attempted: true,
      success: false,
      error: 'RPC https://rpc-user:rpc-password@rpc.example.invalid/v1?apiKey=rpc-query-secret failed',
      logs: ['request to rpc.example.invalid used rpc-log-secret']
    }))
    const broker = new WalletBroker(service, { adapters: { evm: chain } })

    const prepared = await broker.prepareAgentTransaction(agent, wallet.id, { to: wallet.publicAddress })
    expect(prepared).toMatchObject({
      status: 'prepared',
      simulation: { attempted: true, success: false, error: 'Wallet transaction simulation failed' }
    })
    expect(JSON.stringify(prepared)).not.toMatch(/rpc\.example|rpc-user|rpc-password|rpc-query-secret|rpc-log-secret/)

    const requested = await broker.requestAgentTransaction(agent, wallet.id, { to: wallet.publicAddress }, false)
    const requestId = (requested.request as { id: string }).id
    const pending = broker.listPending().find((request) => request.id === requestId)
    expect(JSON.stringify(pending)).not.toMatch(/rpc\.example|rpc-user|rpc-password|rpc-query-secret|rpc-log-secret/)
    const persisted = await readFile(join(directory, 'requests.json'), 'utf8')
    expect(persisted).not.toMatch(/rpc\.example|rpc-user|rpc-password|rpc-query-secret|rpc-log-secret/)
  })

  it('isolates agent address permissions and request status by requester, workspace, tab, and navigation', async () => {
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
    expect(JSON.stringify(broker.agentRequestStatus(agentA, permissionRequest.id))).not.toContain(wallet.publicAddress)
    expect(() => broker.agentRequestStatus(context({
      navigationGeneration: 2,
      topLevelOrigin: 'https://other.example',
      requester: { type: 'agent', id: 'agent-a', name: 'Agent A' }
    }), permissionRequest.id)).toThrow('not found for this agent')
    await broker.approve(permissionRequest.id)
    expect(broker.agentRequestStatus(agentA, permissionRequest.id)).toMatchObject({
      details: { publicAddress: wallet.publicAddress }
    })

    expect(broker.listAgentWallets(agentA)).toEqual([
      expect.objectContaining({ publicAddress: wallet.publicAddress, addressPermission: true })
    ])
    expect(broker.listAgentWallets(agentB)).toEqual([
      expect.not.objectContaining({ publicAddress: expect.anything() })
    ])
    const agentBPermission = await broker.agentBalance(agentB, wallet.id)
    const agentBPermissionId = (agentBPermission.request as { id: string }).id
    const cancelledPermission = await broker.cancelAgentRequest(agentB, agentBPermissionId)
    expect(JSON.stringify(cancelledPermission)).not.toContain(wallet.publicAddress)
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
    await expect(broker.cancelAgentRequest(context({
      navigationGeneration: 2,
      topLevelOrigin: 'https://other.example',
      requester: { type: 'agent', id: 'agent-a', name: 'Agent A' }
    }), requestId)).rejects.toThrow('not found for this agent')
    await expect(broker.cancelAgentRequest(agentB, requestId)).rejects.toThrow('not found for this agent')
    await expect(broker.cancelAgentRequest(context({
      tabId: 'tab-2', requester: { type: 'agent', id: 'agent-a', name: 'Agent A' }
    }), requestId)).rejects.toThrow('not found for this agent')
    await expect(broker.cancelAgentRequest(agentA, requestId)).resolves.toMatchObject({ status: 'cancelled' })
  })

  it('requires human approval for an agent mainnet request without explicit Bypass Approve mode', async () => {
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

  it('lets a dedicated agent wallet use an explicitly bounded Bypass Approve mode on EVM mainnet', async () => {
    const { service, wallet } = await setup('mainnet', true)
    const chain = adapter()
    const broker = new WalletBroker(service, { adapters: { evm: chain } })
    const agent = context({ requester: { type: 'agent', id: 'agent-mainnet-bypass', name: 'Agent' } })
    const permission = await broker.agentBalance(agent, wallet.id)
    await broker.approve((permission.request as { id: string }).id)
    await service.setPolicy({
      id: 'mainnet-bypass', name: 'Bounded mainnet agent', mode: 'bounded-auto', walletId: wallet.id,
      workspaceId: agent.workspaceId, networkIds: [wallet.network.id], origins: [agent.topLevelOrigin],
      destinations: ['0x0000000000000000000000000000000000000002'], methods: ['native-transfer'],
      maxNativeAmount: '0.01', maxTokenAmount: '1', maxFee: '0.001',
      sessionSpendLimit: '0.02', dailySpendLimit: '0.05',
      expiresAt: '2026-09-05T12:00:00.000Z', maximumOperationCount: 10,
      requireSuccessfulSimulation: true, allowMessageSigning: false,
      allowMainnetAgentAutomation: true
    })

    const result = await broker.requestAgentTransaction(agent, wallet.id, {
      to: '0x0000000000000000000000000000000000000002'
    }, true)
    expect(result).toMatchObject({ status: 'requested', request: { status: 'submitted' } })
    const requestId = (result.request as { id: string }).id
    await vi.waitFor(() => expect(broker.agentRequestStatus(agent, requestId).status).toBe('confirmed'))
    expect(chain.sign).toHaveBeenCalledOnce()
    expect(chain.broadcast).toHaveBeenCalledOnce()
  })

  it('keeps websites on trusted approval even when an agent wallet has Bypass Approve mode', async () => {
    const { service, wallet } = await setup('mainnet', true)
    const chain = adapter()
    const broker = new WalletBroker(service, { adapters: { evm: chain } })
    await connect(broker)
    await service.setPolicy({
      id: 'mainnet-agent-only', name: 'Agent only', mode: 'bounded-auto', walletId: wallet.id,
      workspaceId: 'workspace-1', networkIds: [wallet.network.id], origins: ['https://dapp.example'],
      destinations: ['0x0000000000000000000000000000000000000002'], methods: ['native-transfer'],
      maxNativeAmount: '0.01', maxTokenAmount: '1', maxFee: '0.001',
      sessionSpendLimit: '0.02', dailySpendLimit: '0.05',
      expiresAt: '2026-09-05T12:00:00.000Z', maximumOperationCount: 10,
      requireSuccessfulSimulation: true, allowMessageSigning: false,
      allowMainnetAgentAutomation: true
    })

    const result = broker.providerRequest(context(), {
      family: 'evm', method: 'eth_sendTransaction',
      params: [{ to: '0x0000000000000000000000000000000000000002' }]
    })
    await vi.waitFor(() => expect(broker.listPending().filter((request) => (
      request.operation === 'sign-and-send-transaction'
    )).at(-1)?.status).toBe('awaiting-human'))
    expect(chain.sign).not.toHaveBeenCalled()
    await broker.reject(broker.listPending().filter((request) => request.operation === 'sign-and-send-transaction').at(-1)!.id)
    await expect(result).rejects.toThrow('rejected')
  })

  it('requires human approval when a mainnet Bypass Approve policy expires in the lifecycle queue', async () => {
    const { service, wallet } = await setup('mainnet', true)
    const chain = adapter()
    let now = new Date()
    const broker = new WalletBroker(service, { adapters: { evm: chain }, now: () => now })
    const agent = context({ requester: { type: 'agent', id: 'agent-expiring-bypass', name: 'Agent' } })
    const permission = await broker.agentBalance(agent, wallet.id)
    await broker.approve((permission.request as { id: string }).id)
    const policyExpiry = new Date(now.getTime() + 60_000)
    await service.setPolicy({
      id: 'mainnet-expiring-bypass', name: 'Expiring mainnet agent', mode: 'bounded-auto', walletId: wallet.id,
      workspaceId: agent.workspaceId, networkIds: [wallet.network.id], origins: [agent.topLevelOrigin],
      destinations: ['0x0000000000000000000000000000000000000002'], methods: ['native-transfer'],
      maxNativeAmount: '0.01', maxTokenAmount: '1', maxFee: '0.001',
      sessionSpendLimit: '0.02', dailySpendLimit: '0.05',
      expiresAt: policyExpiry.toISOString(), maximumOperationCount: 10,
      requireSuccessfulSimulation: true, allowMessageSigning: false,
      allowMainnetAgentAutomation: true
    })
    let firstBroadcastEntered!: () => void
    const firstBroadcastStarted = new Promise<void>((resolve) => { firstBroadcastEntered = resolve })
    let releaseFirstBroadcast!: () => void
    const firstBroadcastRelease = new Promise<void>((resolve) => { releaseFirstBroadcast = resolve })
    chain.broadcast.mockImplementationOnce(async () => {
      firstBroadcastEntered()
      await firstBroadcastRelease
      return '0xfirst-transaction'
    })

    const first = broker.requestAgentTransaction(agent, wallet.id, {
      to: '0x0000000000000000000000000000000000000002'
    }, true)
    await firstBroadcastStarted
    const second = broker.requestAgentTransaction(agent, wallet.id, {
      to: '0x0000000000000000000000000000000000000002'
    }, true)
    await vi.waitFor(() => expect(broker.listPending().filter((request) => (
      request.operation === 'sign-and-send-transaction' && request.status === 'policy-decision'
    ))).toHaveLength(1))

    now = new Date(policyExpiry.getTime() + 1)
    releaseFirstBroadcast()

    await expect(first).resolves.toMatchObject({ request: { status: 'submitted' } })
    await expect(second).resolves.toMatchObject({ request: { status: 'awaiting-human' } })
    expect(chain.sign).toHaveBeenCalledOnce()
    expect(chain.broadcast).toHaveBeenCalledOnce()
  })

  it('does not create or sign an agent transaction after its requester session is cancelled', async () => {
    const { service, wallet } = await setup('testnet')
    const chain = adapter()
    const broker = new WalletBroker(service, { adapters: { evm: chain } })
    const controller = new AbortController()
    const agent = context({
      requester: { type: 'agent', id: 'wallet-session:closing', name: 'Closing agent' },
      signal: controller.signal
    })
    const permission = await broker.agentBalance(agent, wallet.id)
    await broker.approve((permission.request as { id: string }).id)
    const normalized = await chain.normalizeTransaction(wallet, {})
    let releaseNormalization!: () => void
    const normalizeTransaction = vi.spyOn(chain, 'normalizeTransaction').mockImplementationOnce(() => new Promise((resolve) => {
      releaseNormalization = () => resolve(normalized)
    }))

    const request = broker.requestAgentTransaction(agent, wallet.id, {
      to: '0x0000000000000000000000000000000000000002'
    }, true)
    await vi.waitFor(() => expect(chain.normalizeTransaction).toHaveBeenCalled())
    controller.abort()
    const cancellation = broker.cancelForRequester(agent.requester.id)
    releaseNormalization()

    await cancellation
    await expect(request).rejects.toThrow(/session is no longer active|cancelled/i)
    expect(broker.listPending().filter((entry) => entry.operation.includes('transaction'))).toHaveLength(0)
    expect(chain.sign).not.toHaveBeenCalled()
    expect(chain.broadcast).not.toHaveBeenCalled()
    const normalizationCallsAfterCancellation = normalizeTransaction.mock.calls.length
    await expect(broker.requestAgentTransaction(agent, wallet.id, {}, true))
      .rejects.toThrow(/session is no longer active/i)
    expect(normalizeTransaction).toHaveBeenCalledTimes(normalizationCallsAfterCancellation)
  })

  it('handles requester cancellation that overtakes approval creation without double-cancelling', async () => {
    const { service, wallet } = await setup('testnet')
    const chain = adapter()
    const broker = new WalletBroker(service, { adapters: { evm: chain } })
    const agent = context({ requester: { type: 'agent', id: 'wallet-session:create-race', name: 'Closing agent' } })
    const permission = await broker.agentBalance(agent, wallet.id)
    await broker.approve((permission.request as { id: string }).id)
    const create = service.approvals.create.bind(service.approvals)
    let approvalCreated!: () => void
    const created = new Promise<void>((resolve) => { approvalCreated = resolve })
    let releaseCreate!: () => void
    const createRelease = new Promise<void>((resolve) => { releaseCreate = resolve })
    vi.spyOn(service.approvals, 'create').mockImplementationOnce(async (...args) => {
      const record = await create(...args)
      approvalCreated()
      await createRelease
      return record
    })

    const request = broker.requestAgentTransaction(agent, wallet.id, {
      to: '0x0000000000000000000000000000000000000002'
    }, true)
    await created
    const cancellation = broker.cancelForRequester(agent.requester.id)
    await vi.waitFor(() => expect(broker.listPending().some((entry) => (
      entry.operation.includes('transaction') && entry.status === 'cancelled'
    ))).toBe(true))
    releaseCreate()

    await cancellation
    await expect(request).rejects.toThrow(/session is no longer active/i)
    expect(chain.sign).not.toHaveBeenCalled()
    expect(chain.broadcast).not.toHaveBeenCalled()
  })

  it('stops bounded automatic execution when its agent session closes during signing preparation', async () => {
    const { service, wallet } = await setup('testnet')
    const chain = adapter()
    const broker = new WalletBroker(service, { adapters: { evm: chain } })
    const agent = context({ requester: { type: 'agent', id: 'wallet-session:auto-closing', name: 'Closing agent' } })
    const permission = await broker.agentBalance(agent, wallet.id)
    await broker.approve((permission.request as { id: string }).id)
    await service.setPolicy({
      id: 'agent-auto-close', name: 'Agent close race', mode: 'bounded-auto', walletId: wallet.id,
      workspaceId: agent.workspaceId, networkIds: [wallet.network.id], origins: [agent.topLevelOrigin],
      destinations: ['0x0000000000000000000000000000000000000002'], methods: ['native-transfer'],
      maxNativeAmount: '1', maxFee: '1', expiresAt: '2027-08-28T12:00:00.000Z', maximumOperationCount: 1,
      requireSuccessfulSimulation: true, allowMessageSigning: false
    })
    const markSigning = service.approvals.markSigning.bind(service.approvals)
    let enteredSigning!: () => void
    const signingEntered = new Promise<void>((resolve) => { enteredSigning = resolve })
    let releaseSigning!: () => void
    const signingRelease = new Promise<void>((resolve) => { releaseSigning = resolve })
    vi.spyOn(service.approvals, 'markSigning').mockImplementationOnce(async (...args) => {
      const record = await markSigning(...args)
      enteredSigning()
      await signingRelease
      return record
    })

    const request = broker.requestAgentTransaction(agent, wallet.id, {
      to: '0x0000000000000000000000000000000000000002'
    }, true)
    await signingEntered
    const cancellation = broker.cancelForRequester(agent.requester.id)
    releaseSigning()

    await cancellation
    await expect(request).rejects.toThrow(/session is no longer active|cancelled/i)
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

  it('isolates EVM accounts to the active chain and routes signing to the requested permitted account', async () => {
    const { service, wallet: firstWallet } = await setup('testnet')
    const secondSameChain = await service.generate({
      name: 'Wallet B',
      chainFamily: 'evm',
      network: { ...firstWallet.network },
      workspaceIds: ['workspace-1']
    })
    await service.confirmRecovery(secondSameChain.wallet.id)
    const baseWallet = await service.generate({
      name: 'Wallet C',
      chainFamily: 'evm',
      network: {
        id: '84532', name: 'Base Sepolia', environment: 'testnet', rpcUrl: 'http://127.0.0.1:9545'
      },
      workspaceIds: ['workspace-1']
    })
    await service.confirmRecovery(baseWallet.wallet.id)
    for (const wallet of [firstWallet, secondSameChain.wallet, baseWallet.wallet]) {
      await service.permissions.grant({
        walletId: wallet.id,
        workspaceId: 'workspace-1',
        origin: 'https://dapp.example',
        account: wallet.publicAddress,
        chainFamily: 'evm',
        networkId: wallet.network.id,
        capabilities: ['read'],
        expiresAt: '2027-08-28T12:00:00.000Z'
      })
    }
    const chain = adapter()
    const normalize = vi.spyOn(chain, 'normalizeTransaction').mockImplementation(async (selected, payload) => {
      const requested = payload as { from?: string }
      if (requested.from?.toLowerCase() !== selected.publicAddress.toLowerCase()) {
        throw new Error('EVM transaction signer does not match the selected wallet')
      }
      return {
        chainFamily: 'evm', networkId: selected.network.id, signer: selected.publicAddress,
        nonceOrBlockhash: '7', raw: { from: selected.publicAddress, nonce: 7n },
        decoded: {
          understood: true,
          destination: '0x0000000000000000000000000000000000000002',
          method: 'native-transfer', nativeAmount: '0', estimatedFee: '0.000021',
          unlimitedAllowance: false, newContractOrProgram: false, blindMessage: false
        }
      }
    })
    const providerEvents = vi.fn()
    const broker = new WalletBroker(service, {
      adapters: { evm: chain },
      onProviderEvent: providerEvents
    })

    await expect(broker.providerRequest(context(), { family: 'evm', method: 'eth_chainId' }))
      .resolves.toBe('0xaa36a7')
    await expect(broker.providerRequest(context(), { family: 'evm', method: 'eth_accounts' }))
      .resolves.toEqual([firstWallet.publicAddress, secondSameChain.wallet.publicAddress])

    await expect(broker.providerRequest(context(), {
      family: 'evm', method: 'wallet_switchEthereumChain', params: [{ chainId: '0x14a34' }]
    })).resolves.toBeNull()
    expect(providerEvents).toHaveBeenCalledWith('tab-1', {
      family: 'evm', event: 'chainChanged', payload: '0x14a34'
    })
    expect(providerEvents).toHaveBeenCalledWith('tab-1', {
      family: 'evm', event: 'accountsChanged', payload: [baseWallet.wallet.publicAddress]
    })
    await expect(broker.providerRequest(context(), { family: 'evm', method: 'eth_accounts' }))
      .resolves.toEqual([baseWallet.wallet.publicAddress])
    await expect(broker.providerRequest(context({ tabId: 'tab-2' }), { family: 'evm', method: 'eth_chainId' }))
      .resolves.toBe('0xaa36a7')

    await broker.providerRequest(context(), {
      family: 'evm', method: 'wallet_switchEthereumChain', params: [{ chainId: '0xaa36a7' }]
    })
    const signing = broker.providerRequest(context(), {
      family: 'evm', method: 'eth_signTransaction', params: [{ from: secondSameChain.wallet.publicAddress }]
    })
    await vi.waitFor(() => expect(broker.listPending().find((request) => (
      request.walletId === secondSameChain.wallet.id && request.status === 'awaiting-human'
    ))).toBeDefined())
    const pending = broker.listPending().find((request) => (
      request.walletId === secondSameChain.wallet.id && request.status === 'awaiting-human'
    ))!
    await broker.approve(pending.id)
    await expect(signing).resolves.toBe('signed-transaction')
    expect(normalize).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: secondSameChain.wallet.id }),
      { from: secondSameChain.wallet.publicAddress }
    )
    expect(chain.sign).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: secondSameChain.wallet.id }),
      expect.anything(),
      expect.objectContaining({ signer: secondSameChain.wallet.publicAddress })
    )

    const messageSigning = broker.providerRequest(context(), {
      family: 'evm', method: 'personal_sign', params: ['0x6869', secondSameChain.wallet.publicAddress]
    })
    await vi.waitFor(() => expect(broker.listPending().find((request) => (
      request.walletId === secondSameChain.wallet.id
      && request.operation === 'sign-message'
      && request.status === 'awaiting-human'
    ))).toBeDefined())
    const pendingMessage = broker.listPending().find((request) => (
      request.walletId === secondSameChain.wallet.id
      && request.operation === 'sign-message'
      && request.status === 'awaiting-human'
    ))!
    await broker.approve(pendingMessage.id)
    await expect(messageSigning).resolves.toMatch(/^0x[0-9a-f]+$/i)

    await broker.providerRequest(context(), {
      family: 'evm', method: 'wallet_switchEthereumChain', params: [{ chainId: '0x14a34' }]
    })
    providerEvents.mockClear()
    await expect(broker.removeWallet(baseWallet.wallet.id)).resolves.toBe(true)
    expect(providerEvents).toHaveBeenCalledWith('tab-1', {
      family: 'evm', event: 'chainChanged', payload: '0xaa36a7'
    })
    expect(providerEvents).toHaveBeenCalledWith('tab-1', {
      family: 'evm', event: 'accountsChanged',
      payload: [firstWallet.publicAddress, secondSameChain.wallet.publicAddress]
    })
    await expect(broker.providerRequest(context(), { family: 'evm', method: 'eth_chainId' }))
      .resolves.toBe('0xaa36a7')

    providerEvents.mockClear()
    await expect(broker.removeWallet(secondSameChain.wallet.id)).resolves.toBe(true)
    expect(providerEvents).not.toHaveBeenCalledWith('tab-1', expect.objectContaining({ event: 'chainChanged' }))
    expect(providerEvents).toHaveBeenCalledWith('tab-1', {
      family: 'evm', event: 'accountsChanged', payload: [firstWallet.publicAddress]
    })

    const remainingPermission = service.permissions.list().find((permission) => (
      permission.walletId === firstWallet.id && permission.origin === 'https://dapp.example'
    ))!
    providerEvents.mockClear()
    await expect(broker.revokePermission(remainingPermission.id)).resolves.toBe(true)
    expect(providerEvents).toHaveBeenCalledWith('tab-1', {
      family: 'evm', event: 'accountsChanged', payload: []
    })
    await expect(broker.providerRequest(context(), { family: 'evm', method: 'eth_accounts' }))
      .resolves.toEqual([])
  })

  it('updates connected EVM accounts when the signing vault locks and unlocks', async () => {
    const { service, wallet } = await setup()
    await service.permissions.grant({
      walletId: wallet.id,
      workspaceId: 'workspace-1',
      origin: 'https://dapp.example',
      account: wallet.publicAddress,
      chainFamily: 'evm',
      networkId: wallet.network.id,
      capabilities: ['read'],
      expiresAt: '2027-08-28T12:00:00.000Z'
    })
    const providerEvents = vi.fn()
    const broker = new WalletBroker(service, {
      adapters: { evm: adapter() },
      onProviderEvent: providerEvents
    })

    await expect(broker.providerRequest(context(), { family: 'evm', method: 'eth_accounts' }))
      .resolves.toEqual([wallet.publicAddress])
    providerEvents.mockClear()

    service.lock()
    broker.refreshProviderSessions()
    expect(providerEvents).toHaveBeenCalledWith('tab-1', {
      family: 'evm', event: 'accountsChanged', payload: []
    })

    providerEvents.mockClear()
    await service.unlock('')
    broker.refreshProviderSessions()
    expect(providerEvents).toHaveBeenCalledWith('tab-1', {
      family: 'evm', event: 'accountsChanged', payload: [wallet.publicAddress]
    })
  })

  it('marks address-permission preparation failed instead of leaving it actionable', async () => {
    const { service } = await setup()
    vi.spyOn(service.approvals, 'recordSimulation').mockRejectedValueOnce(new Error('permission preparation failed'))
    const broker = new WalletBroker(service, { adapters: { evm: adapter() } })

    await expect(broker.providerRequest(context(), {
      family: 'evm', method: 'eth_requestAccounts'
    })).rejects.toThrow()

    expect(broker.listPending().find((request) => request.operation === 'connect-account')).toMatchObject({ status: 'failed' })
    expect(await service.auditHistory()).toContainEqual(expect.objectContaining({
      type: 'request-failed',
      payload: expect.objectContaining({ requestId: expect.any(String) })
    }))
  })

  it('marks transaction preparation failed when simulation throws', async () => {
    const { service } = await setup()
    const chain = adapter()
    const broker = new WalletBroker(service, { adapters: { evm: chain } })
    await connect(broker)
    vi.spyOn(chain, 'simulate').mockRejectedValueOnce(new Error('transaction simulation failed'))

    await expect(broker.providerRequest(context(), {
      family: 'evm', method: 'eth_signTransaction',
      params: [{ to: '0x0000000000000000000000000000000000000002' }]
    })).rejects.toThrow()

    expect(broker.listPending().find((request) => request.operation === 'sign-transaction')).toMatchObject({ status: 'failed' })
    expect(await service.auditHistory()).toContainEqual(expect.objectContaining({
      type: 'request-failed',
      payload: expect.objectContaining({ requestId: expect.any(String) })
    }))
  })

  it('marks message preparation failed and clears retained bytes when audit fails', async () => {
    const { service, wallet } = await setup()
    const broker = new WalletBroker(service, { adapters: { evm: adapter() } })
    await connect(broker)
    const append = service.audit.append.bind(service.audit)
    vi.spyOn(service.audit, 'append').mockImplementation(async (type, payload, timestamp) => {
      if (type === 'request-simulated') throw new Error('message audit failed')
      return append(type, payload, timestamp)
    })

    await expect(broker.providerRequest(context(), {
      family: 'evm', method: 'personal_sign', params: ['preparation-secret', wallet.publicAddress]
    })).rejects.toThrow()

    const request = broker.listPending().find((entry) => entry.operation === 'sign-message')
    expect(request).toMatchObject({ status: 'failed' })
    expect(request?.details?.raw).not.toHaveProperty('message')
    expect(await service.auditHistory()).toContainEqual(expect.objectContaining({
      type: 'request-failed',
      payload: expect.objectContaining({ requestId: request?.id })
    }))
  })

  it('cleans up a rejected website request when rejection audit persistence fails', async () => {
    const { service, wallet } = await setup()
    const broker = new WalletBroker(service, { adapters: { evm: adapter() } })
    await connect(broker)
    const result = settle(broker.providerRequest(context(), {
      family: 'evm', method: 'personal_sign', params: ['rejection-audit-secret', wallet.publicAddress]
    }))
    await vi.waitFor(() => expect(broker.listPending().filter((request) => (
      request.operation === 'sign-message' && request.status === 'awaiting-human'
    ))).toHaveLength(1))
    const requestId = broker.listPending().find((request) => (
      request.operation === 'sign-message' && request.status === 'awaiting-human'
    ))!.id
    const append = service.audit.append.bind(service.audit)
    vi.spyOn(service.audit, 'append').mockImplementation(async (type, payload, timestamp) => {
      if (type === 'request-rejected') throw new Error('rejection audit persistence failed')
      return append(type, payload, timestamp)
    })

    await expect(broker.reject(requestId)).rejects.toThrow('rejection audit persistence failed')

    await expect(Promise.race([
      result,
      new Promise((resolve) => setTimeout(() => resolve({ status: 'still-pending' }), 25))
    ])).resolves.toMatchObject({
      status: 'rejected', reason: expect.objectContaining({ message: expect.stringContaining('rejected') })
    })
    expect(broker.listPending().find((request) => request.id === requestId)).toMatchObject({ status: 'rejected' })
    expect(broker.listPending().find((request) => request.id === requestId)?.details?.raw).not.toHaveProperty('message')
  })

  it('cleans up and fails an approved website request when approval audit persistence fails', async () => {
    const { service, wallet } = await setup()
    const broker = new WalletBroker(service, { adapters: { evm: adapter() } })
    await connect(broker)
    const result = settle(broker.providerRequest(context(), {
      family: 'evm', method: 'personal_sign', params: ['approval-audit-secret', wallet.publicAddress]
    }))
    await vi.waitFor(() => expect(broker.listPending().filter((request) => (
      request.operation === 'sign-message' && request.status === 'awaiting-human'
    ))).toHaveLength(1))
    const requestId = broker.listPending().find((request) => (
      request.operation === 'sign-message' && request.status === 'awaiting-human'
    ))!.id
    const append = service.audit.append.bind(service.audit)
    vi.spyOn(service.audit, 'append').mockImplementation(async (type, payload, timestamp) => {
      if (type === 'request-approved') throw new Error('approval audit persistence failed')
      return append(type, payload, timestamp)
    })

    await expect(broker.approve(requestId)).rejects.toThrow()

    await expect(Promise.race([
      result,
      new Promise((resolve) => setTimeout(() => resolve({ status: 'still-pending' }), 25))
    ])).resolves.toMatchObject({
      status: 'rejected', reason: expect.objectContaining({ message: expect.stringContaining('failed') })
    })
    expect(broker.listPending().find((request) => request.id === requestId)).toMatchObject({ status: 'failed' })
    expect(broker.listPending().find((request) => request.id === requestId)?.details?.raw).not.toHaveProperty('message')
  })

  it('cleans up an agent cancellation when cancellation audit persistence fails', async () => {
    const { service, wallet } = await setup()
    const agent = context({ requester: { type: 'agent', id: 'agent-a', name: 'Agent A' } })
    await service.permissions.grant({
      walletId: wallet.id,
      workspaceId: agent.workspaceId,
      origin: agent.topLevelOrigin,
      frameOrigin: agent.topLevelOrigin,
      account: wallet.publicAddress,
      chainFamily: wallet.chainFamily,
      networkId: wallet.network.id,
      capabilities: ['read'],
      requester: agent.requester,
      expiresAt: new Date(Date.now() + 60_000).toISOString()
    })
    const broker = new WalletBroker(service, { adapters: { evm: adapter() } })
    const requested = await broker.requestAgentMessage(agent, wallet.id, Buffer.from('agent-cancellation-secret'))
    const requestId = (requested.request as { id: string }).id
    expect(broker.listPending().find((request) => request.id === requestId)?.details?.raw).toHaveProperty('message')
    const append = service.audit.append.bind(service.audit)
    vi.spyOn(service.audit, 'append').mockImplementation(async (type, payload, timestamp) => {
      if (type === 'request-cancelled') throw new Error('cancellation audit persistence failed')
      return append(type, payload, timestamp)
    })

    await expect(broker.cancelAgentRequest(agent, requestId)).rejects.toThrow('cancellation audit persistence failed')

    expect(broker.listPending().find((request) => request.id === requestId)).toMatchObject({ status: 'cancelled' })
    expect(broker.listPending().find((request) => request.id === requestId)?.details?.raw).not.toHaveProperty('message')
  })

  it('cleans up a revoked website request when revocation audit persistence fails', async () => {
    const { service, wallet } = await setup()
    const chain = adapter()
    const broker = new WalletBroker(service, { adapters: { evm: chain } })
    await connect(broker)
    const permission = service.permissions.list()[0]!
    const result = settle(broker.providerRequest(context(), {
      family: 'evm', method: 'personal_sign', params: ['revocation-audit-secret', wallet.publicAddress]
    }))
    await vi.waitFor(() => expect(broker.listPending().filter((request) => (
      request.operation === 'sign-message' && request.status === 'awaiting-human'
    ))).toHaveLength(1))
    const requestId = broker.listPending().find((request) => (
      request.operation === 'sign-message' && request.status === 'awaiting-human'
    ))!.id
    const append = service.audit.append.bind(service.audit)
    vi.spyOn(service.audit, 'append').mockImplementation(async (type, payload, timestamp) => {
      if (type === 'permission-revoked') throw new Error('revocation audit persistence failed')
      return append(type, payload, timestamp)
    })

    await expect(broker.revokePermission(permission.id)).rejects.toThrow('revocation audit persistence failed')

    await expect(Promise.race([
      result,
      new Promise((resolve) => setTimeout(() => resolve({ status: 'still-pending' }), 25))
    ])).resolves.toMatchObject({
      status: 'rejected', reason: expect.objectContaining({ message: expect.stringContaining('cancelled') })
    })
    expect(broker.listPending().find((request) => request.id === requestId)).toMatchObject({ status: 'cancelled' })
    expect(broker.listPending().find((request) => request.id === requestId)?.details?.raw).not.toHaveProperty('message')
    expect(chain.sign).not.toHaveBeenCalled()
  })

  it('does not expose message approval until its simulation audit is durable', async () => {
    const { service, wallet } = await setup()
    const broker = new WalletBroker(service, { adapters: { evm: adapter() } })
    await connect(broker)
    const permission = service.permissions.list()[0]!
    const append = service.audit.append.bind(service.audit)
    let auditEntered!: () => void
    const entered = new Promise<void>((resolve) => { auditEntered = resolve })
    let releaseAudit!: () => void
    const auditRelease = new Promise<void>((resolve) => { releaseAudit = resolve })
    vi.spyOn(service.audit, 'append').mockImplementation(async (type, payload, timestamp) => {
      if (type === 'request-simulated') {
        auditEntered()
        await auditRelease
      }
      return append(type, payload, timestamp)
    })

    const result = settle(broker.providerRequest(context(), {
      family: 'evm', method: 'personal_sign', params: ['durable-audit-message', wallet.publicAddress]
    }))
    await entered
    expect(broker.listPending().filter((request) => (
      request.operation === 'sign-message' && request.status === 'awaiting-human'
    ))).toHaveLength(0)

    releaseAudit()
    await vi.waitFor(() => expect(broker.listPending().filter((request) => (
      request.operation === 'sign-message' && request.status === 'awaiting-human'
    ))).toHaveLength(1))
    await broker.revokePermission(permission.id)
    await expect(result).resolves.toMatchObject({
      status: 'rejected', reason: expect.objectContaining({ message: expect.stringContaining('cancelled') })
    })
  })

  it('cleans up an expired website request when expiry audit persistence fails during approval', async () => {
    const { service, wallet } = await setup()
    let now = new Date('2026-08-28T12:00:00.000Z')
    const broker = new WalletBroker(service, { adapters: { evm: adapter() }, now: () => now })
    await connect(broker)
    const result = settle(broker.providerRequest(context(), {
      family: 'evm', method: 'personal_sign', params: ['expiry-audit-secret', wallet.publicAddress]
    }))
    await vi.waitFor(() => expect(broker.listPending().filter((request) => (
      request.operation === 'sign-message' && request.status === 'awaiting-human'
    ))).toHaveLength(1))
    const requestId = broker.listPending().find((request) => (
      request.operation === 'sign-message' && request.status === 'awaiting-human'
    ))!.id
    now = new Date('2026-08-28T12:06:00.000Z')
    const append = service.audit.append.bind(service.audit)
    vi.spyOn(service.audit, 'append').mockImplementation(async (type, payload, timestamp) => {
      if (type === 'request-expired') throw new Error('expiry audit persistence failed')
      return append(type, payload, timestamp)
    })

    await expect(broker.approve(requestId)).rejects.toThrow('expiry audit persistence failed')

    await expect(Promise.race([
      result,
      new Promise((resolve) => setTimeout(() => resolve({ status: 'still-pending' }), 25))
    ])).resolves.toMatchObject({
      status: 'rejected', reason: expect.objectContaining({ message: expect.stringContaining('expired') })
    })
    expect(broker.listPending().find((request) => request.id === requestId)).toMatchObject({ status: 'expired' })
    expect(broker.listPending().find((request) => request.id === requestId)?.details?.raw).not.toHaveProperty('message')
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

  it('retries an unresolved submitted transaction until confirmation reaches a terminal state', async () => {
    const { service } = await setup('testnet')
    const chain = adapter()
    const confirmation = vi.spyOn(chain, 'confirmation')
      .mockResolvedValueOnce({ confirmed: false, failed: false })
      .mockResolvedValueOnce({ confirmed: true, failed: false, blockReference: '2' })
    const broker = new WalletBroker(service, {
      adapters: { evm: chain }, confirmationPollIntervalMs: 5
    })
    await connect(broker)

    const result = broker.providerRequest(context(), {
      family: 'evm', method: 'eth_sendTransaction',
      params: [{ to: '0x0000000000000000000000000000000000000002' }]
    })
    await vi.waitFor(() => expect(broker.listPending().filter((request) => (
      request.operation === 'sign-and-send-transaction' && request.status === 'awaiting-human'
    ))).toHaveLength(1))
    const requestId = broker.listPending().find((request) => (
      request.operation === 'sign-and-send-transaction' && request.status === 'awaiting-human'
    ))!.id

    await broker.approve(requestId)
    await expect(result).resolves.toBe('0xtransaction')

    await vi.waitFor(() => expect(confirmation).toHaveBeenCalledTimes(2), { timeout: 500 })
    expect(broker.listPending().find((request) => request.id === requestId)).toMatchObject({
      status: 'confirmed', transactionHash: '0xtransaction'
    })
    await vi.waitFor(async () => expect(await service.auditHistory()).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'transaction-submitted',
        payload: expect.objectContaining({ requestId, transactionHash: '0xtransaction' })
      }),
      expect.objectContaining({
        type: 'transaction-confirmed',
        payload: expect.objectContaining({ requestId, transactionHash: '0xtransaction', blockReference: '2' })
      })
    ])))
  })

  it('resumes confirmation tracking for a durable submitted transaction after restart', async () => {
    const { service, wallet } = await setup('testnet')
    const now = new Date()
    const request = {
      requestId: 'restart-submitted-request', walletId: wallet.id, workspaceId: 'workspace-1', tabId: 'tab-1',
      navigationGeneration: 1, topLevelOrigin: 'https://dapp.example',
      requester: { type: 'website' as const, id: 'https://dapp.example' }, capability: 'send' as const,
      chainFamily: 'evm' as const, networkId: wallet.network.id, operation: 'sign-and-send-transaction' as const,
      payload: {}, expiresAt: new Date(now.getTime() + 60_000).toISOString()
    }
    const created = await service.approvals.create(request, 'restart-submitted-key', now)
    await service.approvals.transition(created.id, 'validated', now)
    await service.approvals.recordSimulation(created.id, { attempted: true, success: true }, now)
    await service.approvals.transition(created.id, 'simulated', now)
    await service.approvals.transition(created.id, 'policy-decision', now)
    await service.approvals.transition(created.id, 'awaiting-human', now)
    await service.approvals.approve(created.id, request, now)
    await service.approvals.markSigning(created.id, request, now)
    await service.approvals.markSubmitted(created.id, '0xsubmitted-before-restart', now)
    const chain = adapter()
    const confirmation = vi.spyOn(chain, 'confirmation')

    const broker = new WalletBroker(service, {
      adapters: { evm: chain }, confirmationPollIntervalMs: 5
    })

    await vi.waitFor(() => expect(confirmation).toHaveBeenCalledWith(wallet, '0xsubmitted-before-restart'), { timeout: 500 })
    expect(broker.listPending().find((entry) => entry.id === created.id)).toMatchObject({
      status: 'confirmed', transactionHash: '0xsubmitted-before-restart'
    })
    await broker.shutdown()
    expect(await service.auditHistory()).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'transaction-confirmed',
        payload: expect.objectContaining({
          requestId: created.id,
          transactionHash: '0xsubmitted-before-restart'
        })
      })
    ]))
  })

  it('drains an in-flight confirmation and its audit before wallet shutdown completes', async () => {
    const { service, wallet } = await setup('testnet')
    const now = new Date()
    const request = {
      requestId: 'shutdown-submitted-request', walletId: wallet.id, workspaceId: 'workspace-1', tabId: 'tab-1',
      navigationGeneration: 1, topLevelOrigin: 'https://dapp.example',
      requester: { type: 'website' as const, id: 'https://dapp.example' }, capability: 'send' as const,
      chainFamily: 'evm' as const, networkId: wallet.network.id, operation: 'sign-and-send-transaction' as const,
      payload: {}, expiresAt: new Date(now.getTime() + 60_000).toISOString()
    }
    const created = await service.approvals.create(request, 'shutdown-submitted-key', now)
    await service.approvals.transition(created.id, 'validated', now)
    await service.approvals.recordSimulation(created.id, { attempted: true, success: true }, now)
    await service.approvals.transition(created.id, 'simulated', now)
    await service.approvals.transition(created.id, 'policy-decision', now)
    await service.approvals.transition(created.id, 'awaiting-human', now)
    await service.approvals.approve(created.id, request, now)
    await service.approvals.markSigning(created.id, request, now)
    await service.approvals.markSubmitted(created.id, '0xsubmitted-before-shutdown', now)

    let finishConfirmation!: (value: { confirmed: boolean; failed: boolean; blockReference: string }) => void
    const confirmationResult = new Promise<{ confirmed: boolean; failed: boolean; blockReference: string }>((resolve) => {
      finishConfirmation = resolve
    })
    const chain = adapter()
    const confirmation = vi.spyOn(chain, 'confirmation').mockReturnValue(confirmationResult)
    const broker = new WalletBroker(service, { adapters: { evm: chain }, confirmationPollIntervalMs: 5 })
    await vi.waitFor(() => expect(confirmation).toHaveBeenCalledOnce(), { timeout: 500 })

    let shutdownSettled = false
    const shutdown = broker.shutdown().then(() => { shutdownSettled = true })
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(shutdownSettled).toBe(false)

    finishConfirmation({ confirmed: true, failed: false, blockReference: 'shutdown-block' })
    await shutdown

    expect(broker.listPending().find((entry) => entry.id === created.id)).toMatchObject({
      status: 'confirmed', transactionHash: '0xsubmitted-before-shutdown'
    })
    expect(await service.auditHistory()).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'transaction-confirmed',
        payload: expect.objectContaining({
          requestId: created.id,
          transactionHash: '0xsubmitted-before-shutdown',
          blockReference: 'shutdown-block'
        })
      })
    ]))
  })

  it('bounds shutdown when a confirmation adapter never settles', async () => {
    const { service, wallet } = await setup('testnet')
    const now = new Date()
    const request = {
      requestId: 'stalled-shutdown-request', walletId: wallet.id, workspaceId: 'workspace-1', tabId: 'tab-1',
      navigationGeneration: 1, topLevelOrigin: 'https://dapp.example',
      requester: { type: 'website' as const, id: 'https://dapp.example' }, capability: 'send' as const,
      chainFamily: 'evm' as const, networkId: wallet.network.id, operation: 'sign-and-send-transaction' as const,
      payload: {}, expiresAt: new Date(now.getTime() + 60_000).toISOString()
    }
    const created = await service.approvals.create(request, 'stalled-shutdown-key', now)
    await service.approvals.transition(created.id, 'validated', now)
    await service.approvals.recordSimulation(created.id, { attempted: true, success: true }, now)
    await service.approvals.transition(created.id, 'simulated', now)
    await service.approvals.transition(created.id, 'policy-decision', now)
    await service.approvals.transition(created.id, 'awaiting-human', now)
    await service.approvals.approve(created.id, request, now)
    await service.approvals.markSigning(created.id, request, now)
    await service.approvals.markSubmitted(created.id, '0xstalled-before-shutdown', now)

    const chain = adapter()
    const confirmation = vi.spyOn(chain, 'confirmation').mockReturnValue(new Promise(() => undefined))
    const broker = new WalletBroker(service, {
      adapters: { evm: chain }, confirmationPollIntervalMs: 5, shutdownDrainTimeoutMs: 20
    })
    await vi.waitFor(() => expect(confirmation).toHaveBeenCalledOnce(), { timeout: 500 })

    await expect(Promise.race([
      broker.shutdown().then(() => 'shutdown'),
      new Promise<string>((resolve) => setTimeout(() => resolve('timed-out'), 250))
    ])).resolves.toBe('shutdown')
    expect(service.approvals.get(created.id)).toMatchObject({
      status: 'submitted', transactionHash: '0xstalled-before-shutdown'
    })
  })

  it('allows a matching bounded testnet policy and rejects mutation/replay through durable request hashes', async () => {
    const { service, wallet } = await setup('testnet')
    const chain = adapter()
    const broker = new WalletBroker(service, { adapters: { evm: chain } })
    await connect(broker)
    await service.setPolicy({
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
    let confirmedRequestId = ''
    await vi.waitFor(() => {
      const confirmed = broker.listPending().find((request) => (
        request.operation === 'sign-and-send-transaction' && request.status === 'confirmed'
      ))
      expect(confirmed).toBeDefined()
      confirmedRequestId = confirmed!.id
    })
    await vi.waitFor(async () => expect(await service.auditHistory()).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'transaction-confirmed',
        payload: expect.objectContaining({ requestId: confirmedRequestId })
      })
    ])))
  })

  it('does not auto-sign after the selected policy is removed before approval', async () => {
    const { service, wallet } = await setup('testnet')
    const chain = adapter()
    const broker = new WalletBroker(service, { adapters: { evm: chain } })
    await connect(broker)
    await broker.setPolicy({
      id: 'policy-revoked-in-flight', name: 'Revoked in flight', mode: 'bounded-auto', walletId: wallet.id,
      workspaceId: 'workspace-1', networkIds: [wallet.network.id], origins: ['https://dapp.example'],
      destinations: ['0x0000000000000000000000000000000000000002'], methods: ['native-transfer'],
      maxNativeAmount: '1', maxFee: '1', expiresAt: '2027-08-28T12:00:00.000Z', maximumOperationCount: 10,
      requireSuccessfulSimulation: true, allowMessageSigning: false
    })

    let reservationReached!: () => void
    let releaseAudit!: () => void
    const reached = new Promise<void>((resolve) => { reservationReached = resolve })
    const release = new Promise<void>((resolve) => { releaseAudit = resolve })
    const append = service.audit.append.bind(service.audit)
    vi.spyOn(service.audit, 'append').mockImplementation(async (type, payload, createdAt) => {
      if (type === 'policy-reservation-created') {
        reservationReached()
        await release
      }
      return append(type, payload, createdAt)
    })

    const result = settle(broker.providerRequest(context(), {
      family: 'evm', method: 'eth_sendTransaction',
      params: [{ to: '0x0000000000000000000000000000000000000002' }]
    }))
    await reached
    const removal = broker.removePolicy('policy-revoked-in-flight')
    releaseAudit()
    await removal

    await vi.waitFor(() => expect(broker.listPending().find((request) => (
      request.operation === 'sign-and-send-transaction'
    ))?.status).toBe('awaiting-human'))
    expect(chain.sign).not.toHaveBeenCalled()
    expect(chain.broadcast).not.toHaveBeenCalled()
    const requestId = broker.listPending().find((request) => (
      request.operation === 'sign-and-send-transaction'
    ))!.id
    await broker.reject(requestId)
    await expect(result).resolves.toMatchObject({ status: 'rejected' })
  })

  it('never executes an authority policy that is not linked by the authenticated wallet descriptor', async () => {
    const { service, wallet } = await setup('testnet')
    const chain = adapter()
    const broker = new WalletBroker(service, { adapters: { evm: chain } })
    await connect(broker)
    await service.policies.set({
      id: 'unlinked-policy', name: 'Unlinked allowance', mode: 'bounded-auto', walletId: wallet.id,
      workspaceId: 'workspace-1', networkIds: [wallet.network.id], origins: ['https://dapp.example'],
      destinations: ['0x0000000000000000000000000000000000000002'], methods: ['native-transfer'],
      maxNativeAmount: '1', maxFee: '1', expiresAt: '2027-08-28T12:00:00.000Z', maximumOperationCount: 1,
      requireSuccessfulSimulation: true, allowMessageSigning: false
    })

    const result = settle(broker.providerRequest(context(), {
      family: 'evm', method: 'eth_sendTransaction', params: [{ to: '0x0000000000000000000000000000000000000002' }]
    }))
    await vi.waitFor(() => expect(broker.listPending().filter((request) => (
      request.operation === 'sign-and-send-transaction'
    )).at(-1)?.status).toBe('awaiting-human'))
    expect(chain.sign).not.toHaveBeenCalled()
    const pending = broker.listPending().filter((request) => request.operation === 'sign-and-send-transaction').at(-1)!
    await broker.reject(pending.id)
    await expect(result).resolves.toMatchObject({ status: 'rejected' })
  })

  it('does not let concurrent automatic requests exceed a durable operation limit', async () => {
    const { service, wallet } = await setup('testnet')
    const chain = adapter()
    const broker = new WalletBroker(service, { adapters: { evm: chain } })
    await connect(broker)
    await service.setPolicy({
      id: 'policy-one-operation', name: 'One operation only', mode: 'bounded-auto', walletId: wallet.id,
      workspaceId: 'workspace-1', networkIds: [wallet.network.id], origins: ['https://dapp.example'],
      destinations: ['0x0000000000000000000000000000000000000002'], methods: ['native-transfer'],
      maxNativeAmount: '1', maxFee: '1', sessionSpendLimit: '1', dailySpendLimit: '1',
      expiresAt: '2027-08-28T12:00:00.000Z', maximumOperationCount: 1,
      requireSuccessfulSimulation: true, allowMessageSigning: false
    })

    const requests = [0, 1].map(() => settle(broker.providerRequest(context(), {
      family: 'evm' as const,
      method: 'eth_sendTransaction' as const,
      params: [{ to: '0x0000000000000000000000000000000000000002' }]
    })))
    await vi.waitFor(() => expect(broker.listPending().filter((request) => (
      request.operation === 'sign-and-send-transaction' && request.status === 'awaiting-human'
    ))).toHaveLength(1))

    await vi.waitFor(() => {
      expect(chain.sign).toHaveBeenCalledOnce()
      expect(chain.broadcast).toHaveBeenCalledOnce()
    })
    const awaiting = broker.listPending().find((request) => (
      request.operation === 'sign-and-send-transaction' && request.status === 'awaiting-human'
    ))!
    await broker.reject(awaiting.id)
    const settled = await Promise.all(requests)
    expect(settled.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(settled.filter((result) => result.status === 'rejected')).toHaveLength(1)
    let confirmedRequestId = ''
    await vi.waitFor(() => {
      const confirmed = broker.listPending().find((request) => (
        request.operation === 'sign-and-send-transaction' && request.status === 'confirmed'
      ))
      expect(confirmed).toBeDefined()
      confirmedRequestId = confirmed!.id
    })
    await vi.waitFor(async () => expect(await service.auditHistory()).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'transaction-confirmed',
        payload: expect.objectContaining({ requestId: confirmedRequestId })
      })
    ])))
  })

  it('cancels a pending website request on navigation and never reaches the signer', async () => {
    const { service } = await setup()
    const chain = adapter()
    const broker = new WalletBroker(service, { adapters: { evm: chain } })
    const result = settle(broker.providerRequest(context(), { family: 'evm', method: 'eth_requestAccounts' }))
    await vi.waitFor(() => expect(broker.listPending().some((request) => request.status === 'awaiting-human')).toBe(true))

    await broker.cancelForNavigation('tab-1', 2)

    await expect(result).resolves.toMatchObject({
      status: 'rejected', reason: expect.objectContaining({ message: expect.stringContaining('cancelled') })
    })
    expect(chain.sign).not.toHaveBeenCalled()
  })

  it('revokes an account permission persisted while the requesting page navigates', async () => {
    const { service, wallet } = await setup()
    const broker = new WalletBroker(service, { adapters: { evm: adapter() } })
    const grant = service.permissions.grant.bind(service.permissions)
    let permissionPersisted!: () => void
    const persisted = new Promise<void>((resolve) => { permissionPersisted = resolve })
    let releaseGrant!: () => void
    const grantRelease = new Promise<void>((resolve) => { releaseGrant = resolve })
    vi.spyOn(service.permissions, 'grant').mockImplementationOnce(async (...args) => {
      const permission = await grant(...args)
      permissionPersisted()
      await grantRelease
      return permission
    })

    const result = settle(broker.providerRequest(context(), { family: 'evm', method: 'eth_requestAccounts' }))
    await vi.waitFor(() => expect(broker.listPending().some((request) => request.status === 'awaiting-human')).toBe(true))
    const pending = broker.listPending().find((request) => request.status === 'awaiting-human')!
    const approval = settle(broker.approve(pending.id))
    await persisted

    const cancellation = broker.cancelForNavigation('tab-1', 2)
    releaseGrant()
    await cancellation

    await expect(approval).resolves.toMatchObject({
      status: 'rejected', reason: expect.objectContaining({ message: expect.stringMatching(/cancelled|no longer active/i) })
    })
    await expect(result).resolves.toMatchObject({ status: 'rejected' })
    expect(service.permissions.allows({
      walletId: wallet.id,
      workspaceId: 'workspace-1',
      origin: 'https://dapp.example',
      account: wallet.publicAddress,
      chainFamily: wallet.chainFamily,
      networkId: wallet.network.id,
      requester: { type: 'website', id: 'https://dapp.example' },
      capability: 'read'
    })).toBe(false)
  })

  it('revokes a new account permission when navigation overtakes the signing transition', async () => {
    const { service, wallet } = await setup()
    const providerEvent = vi.fn()
    const broker = new WalletBroker(service, {
      adapters: { evm: adapter() },
      onProviderEvent: providerEvent
    })
    const transition = service.approvals.transition.bind(service.approvals)
    let signingPersisted!: () => void
    const persisted = new Promise<void>((resolve) => { signingPersisted = resolve })
    let releaseTransition!: () => void
    const transitionRelease = new Promise<void>((resolve) => { releaseTransition = resolve })
    vi.spyOn(service.approvals, 'transition').mockImplementation(async (...args) => {
      const record = await transition(...args)
      if (args[1] === 'signing') {
        signingPersisted()
        await transitionRelease
      }
      return record
    })

    const result = settle(broker.providerRequest(context(), { family: 'evm', method: 'eth_requestAccounts' }))
    await vi.waitFor(() => expect(broker.listPending().some((request) => request.status === 'awaiting-human')).toBe(true))
    const pending = broker.listPending().find((request) => request.status === 'awaiting-human')!
    const approval = settle(broker.approve(pending.id))
    await persisted

    const cancellation = broker.cancelForNavigation('tab-1', 2)
    releaseTransition()
    await cancellation

    await expect(approval).resolves.toMatchObject({ status: 'rejected' })
    await expect(result).resolves.toMatchObject({ status: 'rejected' })
    expect(service.permissions.allows({
      walletId: wallet.id,
      workspaceId: 'workspace-1',
      origin: 'https://dapp.example',
      account: wallet.publicAddress,
      chainFamily: wallet.chainFamily,
      networkId: wallet.network.id,
      requester: { type: 'website', id: 'https://dapp.example' },
      capability: 'read'
    })).toBe(false)
    expect(providerEvent).not.toHaveBeenCalled()
  })

  it.each([
    ['navigation', (broker: WalletBroker) => broker.cancelForNavigation('tab-1', 2)],
    ['tab closure', (broker: WalletBroker) => broker.cancelForTab('tab-1')]
  ])('rejects a website request when %s overtakes durable request creation', async (_event, cancel) => {
    const { service, wallet } = await setup()
    const chain = adapter()
    const broker = new WalletBroker(service, { adapters: { evm: chain } })
    await connect(broker)
    const normalized = await chain.normalizeTransaction(wallet, {})
    let normalizationEntered!: () => void
    const entered = new Promise<void>((resolve) => { normalizationEntered = resolve })
    let releaseNormalization!: () => void
    vi.spyOn(chain, 'normalizeTransaction').mockImplementationOnce(() => new Promise((resolve) => {
      normalizationEntered()
      releaseNormalization = () => resolve(normalized)
    }))

    const result = settle(broker.providerRequest(context(), {
      family: 'evm', method: 'eth_signTransaction',
      params: [{ to: '0x0000000000000000000000000000000000000002' }]
    }))
    await entered
    await cancel(broker)
    releaseNormalization()

    await expect(Promise.race([
      result,
      new Promise((resolve) => setTimeout(() => resolve({ status: 'still-pending' }), 100))
    ])).resolves.toMatchObject({
      status: 'rejected', reason: expect.objectContaining({ message: expect.stringMatching(/cancelled|no longer active/i) })
    })
    expect(broker.listPending().filter((request) => (
      request.operation === 'sign-transaction' && !['cancelled', 'failed'].includes(request.status)
    ))).toHaveLength(0)
    expect(chain.sign).not.toHaveBeenCalled()
    expect(chain.broadcast).not.toHaveBeenCalled()
  })

  it('cancels a website request when navigation lands while durable creation is returning', async () => {
    const { service } = await setup()
    const chain = adapter()
    const broker = new WalletBroker(service, { adapters: { evm: chain } })
    await connect(broker)
    const create = service.approvals.create.bind(service.approvals)
    let approvalCreated!: () => void
    const created = new Promise<void>((resolve) => { approvalCreated = resolve })
    let releaseCreate!: () => void
    const createRelease = new Promise<void>((resolve) => { releaseCreate = resolve })
    vi.spyOn(service.approvals, 'create').mockImplementationOnce(async (...args) => {
      const record = await create(...args)
      approvalCreated()
      await createRelease
      return record
    })

    const result = settle(broker.providerRequest(context(), {
      family: 'evm', method: 'eth_signTransaction',
      params: [{ to: '0x0000000000000000000000000000000000000002' }]
    }))
    await created
    await broker.cancelForNavigation('tab-1', 2)
    releaseCreate()

    await expect(result).resolves.toMatchObject({
      status: 'rejected', reason: expect.objectContaining({ message: expect.stringMatching(/no longer active/i) })
    })
    expect(service.approvals.list().filter((request) => request.request.operation === 'sign-transaction')).toEqual([
      expect.objectContaining({
        status: 'cancelled',
        request: expect.objectContaining({ navigationGeneration: 1 })
      })
    ])
    expect(chain.sign).not.toHaveBeenCalled()
    expect(chain.broadcast).not.toHaveBeenCalled()
  })

  it('does not auto-sign a bounded website request after its page navigates during normalization', async () => {
    const { service, wallet } = await setup()
    const chain = adapter()
    const broker = new WalletBroker(service, { adapters: { evm: chain } })
    await connect(broker)
    await service.setPolicy({
      id: 'website-navigation-auto', name: 'Website navigation race', mode: 'bounded-auto', walletId: wallet.id,
      workspaceId: 'workspace-1', networkIds: [wallet.network.id], origins: ['https://dapp.example'],
      destinations: ['0x0000000000000000000000000000000000000002'], methods: ['native-transfer'],
      maxNativeAmount: '1', maxFee: '1', expiresAt: '2027-08-28T12:00:00.000Z', maximumOperationCount: 1,
      requireSuccessfulSimulation: true, allowMessageSigning: false
    })
    const normalized = await chain.normalizeTransaction(wallet, {})
    let normalizationEntered!: () => void
    const entered = new Promise<void>((resolve) => { normalizationEntered = resolve })
    let releaseNormalization!: () => void
    vi.spyOn(chain, 'normalizeTransaction').mockImplementationOnce(() => new Promise((resolve) => {
      normalizationEntered()
      releaseNormalization = () => resolve(normalized)
    }))

    const result = broker.providerRequest(context(), {
      family: 'evm', method: 'eth_sendTransaction',
      params: [{ to: '0x0000000000000000000000000000000000000002' }]
    })
    await entered
    await broker.cancelForNavigation('tab-1', 2)
    releaseNormalization()

    await expect(result).rejects.toThrow(/no longer active/i)
    expect(chain.sign).not.toHaveBeenCalled()
    expect(chain.broadcast).not.toHaveBeenCalled()
  })

  it('disconnects only the selected Solana wallet and cancels its pending requests', async () => {
    const { service, wallet: evmWallet } = await setup()
    const generated = await service.generate({
      name: 'Solana wallet', chainFamily: 'solana',
      network: { id: 'devnet', name: 'Solana devnet', environment: 'testnet', rpcUrl: 'http://127.0.0.1:8899' },
      workspaceIds: ['workspace-1']
    })
    const solanaWallet = await service.confirmRecovery(generated.wallet.id)
    const broker = new WalletBroker(service, { adapters: { evm: adapter() } })
    await connect(broker)

    const solanaConnection = broker.providerRequest(context(), { family: 'solana', method: 'connect' })
    await vi.waitFor(() => expect(broker.listPending().filter((request) => (
      request.walletId === solanaWallet.id && request.status === 'awaiting-human'
    ))).toHaveLength(1))
    const connectionRequest = broker.listPending().find((request) => (
      request.walletId === solanaWallet.id && request.status === 'awaiting-human'
    ))!
    await broker.approve(connectionRequest.id)
    await expect(solanaConnection).resolves.toMatchObject({ accounts: [{ address: solanaWallet.publicAddress }] })

    const signing = settle(broker.providerRequest(context(), {
      family: 'solana', method: 'signMessage',
      params: [{ account: { address: solanaWallet.publicAddress }, message: Uint8Array.from([1, 2, 3]) }]
    }))
    await vi.waitFor(() => expect(broker.listPending().filter((request) => (
      request.walletId === solanaWallet.id && request.operation === 'sign-message' && request.status === 'awaiting-human'
    ))).toHaveLength(1))

    await expect(broker.providerRequest(context(), { family: 'solana', method: 'disconnect' })).resolves.toBeUndefined()

    await expect(Promise.race([
      signing,
      new Promise((resolve) => setTimeout(() => resolve({ status: 'still-pending' }), 25))
    ])).resolves.toMatchObject({
      status: 'rejected', reason: expect.objectContaining({ message: expect.stringContaining('cancelled') })
    })
    await expect(broker.providerRequest(context(), { family: 'evm', method: 'eth_accounts' }))
      .resolves.toEqual([evmWallet.publicAddress])
    expect(service.permissions.list()).toEqual([
      expect.objectContaining({ walletId: evmWallet.id, chainFamily: 'evm' })
    ])
    expect(await service.auditHistory()).toContainEqual(expect.objectContaining({
      type: 'permission-revoked',
      payload: expect.objectContaining({ walletId: solanaWallet.id, origin: 'https://dapp.example' })
    }))
  })

  it('keeps silent Solana reconnect checks from opening trusted approval UI', async () => {
    const { service } = await setup()
    const generated = await service.generate({
      name: 'Solana wallet', chainFamily: 'solana',
      network: { id: 'devnet', name: 'Solana devnet', environment: 'testnet', rpcUrl: 'http://127.0.0.1:8899' },
      workspaceIds: ['workspace-1']
    })
    const solanaWallet = await service.confirmRecovery(generated.wallet.id)
    const broker = new WalletBroker(service, { adapters: { evm: adapter() } })

    const standard = settle(broker.providerRequest(context(), {
      family: 'solana', method: 'connect', params: { silent: true }
    }))

    await expect(Promise.race([
      standard,
      new Promise((resolve) => setTimeout(() => resolve({ status: 'still-pending' }), 25))
    ])).resolves.toEqual({ status: 'fulfilled', value: { accounts: [] } })
    expect(broker.listPending().filter((request) => request.operation === 'connect-account')).toHaveLength(0)

    await expect(broker.providerRequest(context(), {
      family: 'solana', method: 'connect', params: { onlyIfTrusted: true }
    })).resolves.toEqual({ accounts: [] })
    await expect(broker.providerRequest(context({ workspaceId: 'workspace-without-solana' }), {
      family: 'solana', method: 'connect', params: { silent: true }
    })).resolves.toEqual({ accounts: [] })

    await service.permissions.grant({
      walletId: solanaWallet.id,
      workspaceId: 'workspace-1',
      origin: 'https://dapp.example',
      account: solanaWallet.publicAddress,
      chainFamily: 'solana',
      networkId: solanaWallet.network.id,
      capabilities: ['read'],
      requester: { type: 'website', id: 'https://dapp.example' },
      expiresAt: new Date(Date.now() + 60_000).toISOString()
    })
    await expect(broker.providerRequest(context(), {
      family: 'solana', method: 'connect', params: { silent: true }
    })).resolves.toMatchObject({ accounts: [{ address: solanaWallet.publicAddress }] })
    expect(broker.listPending().filter((request) => request.operation === 'connect-account')).toHaveLength(0)
    expect(service.permissions.list()).toHaveLength(1)
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
    const result = settle(broker.providerRequest(context(), {
      family: 'evm', method: 'eth_signTransaction',
      params: [{ to: '0x0000000000000000000000000000000000000002' }]
    }))
    await vi.waitFor(() => expect(broker.listPending().filter((request) => request.operation === 'sign-transaction').at(-1)?.status)
      .toBe('awaiting-human'))

    await broker.updateWallet(wallet.id, { workspaceIds: ['workspace-2'] })

    await expect(result).resolves.toMatchObject({
      status: 'rejected', reason: expect.objectContaining({ message: expect.stringContaining('cancelled') })
    })
    expect(service.list()[0]?.workspaceIds).toEqual(['workspace-2'])
    expect(service.list()[0]?.policyIds).toEqual(['policy-retained-workspace'])
    expect(service.policies.list(wallet.id)).toEqual([
      expect.objectContaining({ id: 'policy-retained-workspace', workspaceId: 'workspace-2' })
    ])
    expect(service.permissions.list()).toHaveLength(0)
    expect(chain.sign).not.toHaveBeenCalled()
  })

  it('replaces a failed RPC endpoint without changing identity and invalidates endpoint-bound authority', async () => {
    const { service, wallet } = await setup()
    const chain = adapter()
    const broker = new WalletBroker(service, { adapters: { evm: chain } })
    await connect(broker)
    await service.setPolicy({
      id: 'policy-old-rpc', name: 'Old endpoint automation', mode: 'bounded-auto', walletId: wallet.id,
      workspaceId: 'workspace-1', networkIds: [wallet.network.id], origins: ['https://automation.example'],
      destinations: ['0x0000000000000000000000000000000000000002'], methods: ['native-transfer'],
      maxNativeAmount: '1', maxFee: '1', expiresAt: '2027-08-28T12:00:00.000Z', maximumOperationCount: 10,
      requireSuccessfulSimulation: true, allowMessageSigning: false
    })
    const signing = settle(broker.providerRequest(context(), {
      family: 'evm', method: 'personal_sign', params: ['rpc-change', wallet.publicAddress]
    }))
    await vi.waitFor(() => expect(broker.listPending().at(-1)?.status).toBe('awaiting-human'))

    const updated = await broker.updateWallet(wallet.id, { rpcUrl: 'http://127.0.0.1:9545' })

    await expect(signing).resolves.toMatchObject({
      status: 'rejected', reason: expect.objectContaining({ message: expect.stringContaining('cancelled') })
    })
    expect(updated).toMatchObject({
      id: wallet.id,
      publicAddress: wallet.publicAddress,
      chainFamily: wallet.chainFamily,
      network: {
        id: wallet.network.id,
        name: wallet.network.name,
        environment: wallet.network.environment,
        rpcUrl: 'http://127.0.0.1:9545'
      }
    })
    expect(service.policies.list(wallet.id)).toEqual([])
    expect(service.permissions.list()).toHaveLength(1)
    const audit = await service.auditHistory()
    expect(audit).toContainEqual(expect.objectContaining({
      type: 'wallet-rpc-updated',
      payload: expect.objectContaining({
        walletId: wallet.id,
        chainFamily: wallet.chainFamily,
        networkId: wallet.network.id,
        removedPolicyCount: 1
      })
    }))
    expect(JSON.stringify(audit)).not.toContain('127.0.0.1:9545')
    expect(chain.sign).not.toHaveBeenCalled()
  })

  it('makes an any-workspace wallet discoverable without bypassing address approval', async () => {
    const { service, wallet } = await setup()
    const broker = new WalletBroker(service, { adapters: { evm: adapter() } })
    await broker.updateWallet(wallet.id, { availableInAllWorkspaces: true })
    const otherWorkspace = context({
      workspaceId: 'workspace-created-later',
      tabId: 'tab-created-later',
      requester: { type: 'agent', id: 'agent-created-later' }
    })

    expect(broker.listAgentWallets(otherWorkspace)).toContainEqual(expect.objectContaining({
      id: wallet.id,
      availableInAllWorkspaces: true,
      addressPermission: false
    }))
    expect(JSON.stringify(broker.listAgentWallets(otherWorkspace))).not.toContain(wallet.publicAddress)
    await expect(broker.agentBalance(otherWorkspace, wallet.id)).resolves.toMatchObject({
      status: 'permission-required',
      request: expect.objectContaining({ status: 'awaiting-human' })
    })
  })

  it('cancels out-of-scope requests and permissions when any-workspace access is narrowed', async () => {
    const { service, wallet } = await setup()
    const chain = adapter()
    const broker = new WalletBroker(service, { adapters: { evm: chain } })
    await broker.updateWallet(wallet.id, { availableInAllWorkspaces: true })
    const otherWorkspace = context({ workspaceId: 'workspace-2', tabId: 'tab-2' })
    const connection = broker.providerRequest(otherWorkspace, { family: 'evm', method: 'eth_requestAccounts' })
    await vi.waitFor(() => expect(broker.listPending().at(-1)?.status).toBe('awaiting-human'))
    await broker.approve(broker.listPending().at(-1)!.id)
    await expect(connection).resolves.toEqual([wallet.publicAddress])
    const signing = settle(broker.providerRequest(otherWorkspace, {
      family: 'evm', method: 'personal_sign', params: ['scope-change', wallet.publicAddress]
    }))
    await vi.waitFor(() => expect(broker.listPending().at(-1)?.status).toBe('awaiting-human'))

    await broker.updateWallet(wallet.id, {
      availableInAllWorkspaces: false,
      workspaceIds: ['workspace-1']
    })

    await expect(signing).resolves.toMatchObject({
      status: 'rejected', reason: expect.objectContaining({ message: expect.stringContaining('cancelled') })
    })
    expect(service.permissions.list().filter((permission) => permission.workspaceId === 'workspace-2')).toEqual([])
    expect(broker.listAgentWallets(otherWorkspace)).toEqual([])
    expect(chain.sign).not.toHaveBeenCalled()
  })

  it('cancels only matching pending requests when their address permission is revoked', async () => {
    const { service, wallet } = await setup()
    const chain = adapter()
    const broker = new WalletBroker(service, { adapters: { evm: chain } })
    await connect(broker)
    const permission = service.permissions.list()[0]!
    const result = settle(broker.providerRequest(context(), {
      family: 'evm', method: 'personal_sign', params: ['permission-revoked', wallet.publicAddress]
    }))
    await vi.waitFor(() => expect(broker.listPending().filter((request) => request.operation === 'sign-message').at(-1)?.status)
      .toBe('awaiting-human'))

    await expect(broker.revokePermission(permission.id)).resolves.toBe(true)

    await expect(result).resolves.toMatchObject({
      status: 'rejected', reason: expect.objectContaining({ message: expect.stringContaining('cancelled') })
    })
    expect(service.permissions.list()).toHaveLength(0)
    expect(chain.sign).not.toHaveBeenCalled()
  })

  it('rejects a live provider waiter and clears message details when its wallet is removed', async () => {
    const { service, wallet } = await setup()
    const broker = new WalletBroker(service, { adapters: { evm: adapter() } })
    await connect(broker)
    const simulationStarted = deferred()
    const continueSimulation = deferred()
    const recordSimulation = service.approvals.recordSimulation.bind(service.approvals)
    vi.spyOn(service.approvals, 'recordSimulation').mockImplementation(async (...args) => {
      simulationStarted.resolve()
      await continueSimulation.promise
      return recordSimulation(...args)
    })
    const result = settle(broker.providerRequest(context(), {
      family: 'evm', method: 'personal_sign', params: ['remove-pending-wallet', wallet.publicAddress]
    }))
    await simulationStarted.promise

    await expect(broker.removeWallet(wallet.id)).resolves.toBe(true)
    continueSimulation.resolve()

    await expect(result).resolves.toMatchObject({
      status: 'rejected', reason: expect.objectContaining({ message: expect.stringContaining('cancelled') })
    })
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
    const result = settle(broker.providerRequest(context(), { family: 'evm', method: 'eth_requestAccounts' }))
    await vi.waitFor(() => expect(broker.listPending().find((request) => request.status === 'awaiting-human')).toBeDefined())
    const pending = broker.listPending().find((request) => request.status === 'awaiting-human')!
    now = new Date('2026-08-28T12:06:00.000Z')

    await expect(broker.approve(pending.id)).rejects.toThrow('expired')
    await expect(Promise.race([
      result,
      new Promise((resolve) => setTimeout(() => resolve({ status: 'still-pending' }), 20))
    ])).resolves.toMatchObject({
      status: 'rejected', reason: expect.objectContaining({ message: expect.stringContaining('expired') })
    })
    expect(broker.listPending().find((request) => request.id === pending.id)?.status).toBe('expired')
  })

  it('actively expires an untouched request and clears its retained message', async () => {
    const { service, wallet } = await setup()
    await service.permissions.grant({
      walletId: wallet.id,
      workspaceId: 'workspace-1',
      origin: 'https://dapp.example',
      frameOrigin: 'https://dapp.example',
      account: wallet.publicAddress,
      chainFamily: wallet.chainFamily,
      networkId: wallet.network.id,
      capabilities: ['read'],
      requester: { type: 'website', id: 'https://dapp.example' },
      expiresAt: new Date(Date.now() + 60_000).toISOString()
    })
    let expireRequest!: () => void
    let scheduledDelay = -1
    let pendingReady!: () => void
    const ready = new Promise<void>((resolve) => { pendingReady = resolve })
    const cancelExpiry = vi.fn()
    let now = new Date('2026-08-31T12:00:00.000Z')
    const broker = new WalletBroker(service, {
      adapters: { evm: adapter() },
      now: () => now,
      requestTtlMs: 100,
      requestExpiryScheduler: (callback, delay) => {
        expireRequest = callback
        scheduledDelay = delay
        return cancelExpiry
      },
      onPendingChanged: (requests) => {
        if (requests.some((request) => request.operation === 'sign-message' && request.status === 'awaiting-human')) {
          pendingReady()
        }
      }
    })
    const result = settle(broker.providerRequest(context(), {
      family: 'evm', method: 'personal_sign', params: ['untouched-expiring-message', wallet.publicAddress]
    }))
    await ready
    const requestId = broker.listPending().find((request) => (
      request.operation === 'sign-message' && request.status === 'awaiting-human'
    ))!.id

    expect(scheduledDelay).toBe(100)
    now = new Date(now.getTime() + 100)
    expireRequest()
    await expect(result).resolves.toMatchObject({
      status: 'rejected', reason: expect.objectContaining({ message: expect.stringContaining('expired') })
    })
    expect(broker.listPending().find((request) => request.id === requestId)).toMatchObject({ status: 'expired' })
    expect(broker.listPending().find((request) => request.id === requestId)?.details?.raw).not.toHaveProperty('message')
    expect(cancelExpiry).not.toHaveBeenCalled()
    expect(await service.auditHistory()).toContainEqual(expect.objectContaining({
      type: 'request-expired',
      payload: expect.objectContaining({ requestId, walletId: wallet.id })
    }))
  })

  it('rejects the waiting caller when expiry persistence has an uncertain failure', async () => {
    const { service, wallet } = await setup()
    await service.permissions.grant({
      walletId: wallet.id,
      workspaceId: 'workspace-1',
      origin: 'https://dapp.example',
      frameOrigin: 'https://dapp.example',
      account: wallet.publicAddress,
      chainFamily: wallet.chainFamily,
      networkId: wallet.network.id,
      capabilities: ['read'],
      requester: { type: 'website', id: 'https://dapp.example' },
      expiresAt: new Date(Date.now() + 60_000).toISOString()
    })
    const transition = service.approvals.transition.bind(service.approvals)
    vi.spyOn(service.approvals, 'transition').mockImplementation(async (requestId, status, now) => {
      const record = await transition(requestId, status, now)
      if (status === 'expired') throw new Error('expiry persistence result was uncertain')
      return record
    })
    let expireRequest!: () => void
    let scheduledDelay = -1
    let pendingReady!: () => void
    const ready = new Promise<void>((resolve) => { pendingReady = resolve })
    let now = new Date('2026-08-31T12:00:00.000Z')
    const broker = new WalletBroker(service, {
      adapters: { evm: adapter() },
      now: () => now,
      requestTtlMs: 100,
      requestExpiryScheduler: (callback, delay) => {
        expireRequest = callback
        scheduledDelay = delay
        return vi.fn()
      },
      onPendingChanged: (requests) => {
        if (requests.some((request) => request.operation === 'sign-message' && request.status === 'awaiting-human')) {
          pendingReady()
        }
      }
    })
    const result = settle(broker.providerRequest(context(), {
      family: 'evm', method: 'personal_sign', params: ['uncertain-expiry-message', wallet.publicAddress]
    }))
    await ready
    const requestId = broker.listPending().find((request) => (
      request.operation === 'sign-message' && request.status === 'awaiting-human'
    ))!.id

    expect(scheduledDelay).toBe(100)
    now = new Date(now.getTime() + 100)
    expireRequest()
    await expect(result).resolves.toMatchObject({
      status: 'rejected', reason: expect.objectContaining({ message: expect.stringContaining('expired') })
    })
    expect(broker.listPending().find((request) => request.id === requestId)).toMatchObject({ status: 'expired' })
    expect(broker.listPending().find((request) => request.id === requestId)?.details?.raw).not.toHaveProperty('message')
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
