import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WalletPermissionStore } from '../src/main/wallet/permissions.js'
import { WalletPolicyEngine } from '../src/main/wallet/policy.js'
import { createTestWalletAuthority } from './helpers/wallet-authority.js'
import type {
  WalletDescriptor,
  WalletOperationRequest,
  WalletPolicy
} from '../src/shared/wallet.js'

const temporaryDirectories: string[] = []

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-08-28T12:00:00.000Z'))
})

afterEach(async () => {
  vi.useRealTimers()
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

async function permissionStore(): Promise<WalletPermissionStore> {
  const directory = await mkdtemp(join(tmpdir(), 'hronaut-wallet-permissions-test-'))
  temporaryDirectories.push(directory)
  const store = new WalletPermissionStore(await createTestWalletAuthority(directory))
  await store.load()
  return store
}

function request(overrides: Partial<WalletOperationRequest> = {}): WalletOperationRequest {
  return {
    requestId: 'request-1',
    walletId: 'wallet-1',
    workspaceId: 'workspace-1',
    tabId: 'tab-1',
    navigationGeneration: 1,
    topLevelOrigin: 'https://dapp.example',
    requester: { type: 'website', id: 'tab-1', name: 'Dapp' },
    capability: 'sign',
    chainFamily: 'evm',
    networkId: '11155111',
    operation: 'sign-transaction',
    payload: {},
    expiresAt: '2026-08-28T13:00:00.000Z',
    ...overrides
  }
}

const wallet: WalletDescriptor = {
  id: 'wallet-1',
  name: 'EVM test wallet',
  kind: 'agent',
  chainFamily: 'evm',
  publicAddress: '0x0000000000000000000000000000000000000001',
  network: { id: '11155111', name: 'Sepolia', environment: 'testnet', rpcUrl: 'http://127.0.0.1:8545' },
  capabilities: ['read', 'sign', 'send'],
  workspaceIds: ['workspace-1'],
  policyIds: ['policy-1'],
  recoveryConfirmed: true,
  createdAt: '2026-08-28T12:00:00.000Z',
  updatedAt: '2026-08-28T12:00:00.000Z'
}

const policy: WalletPolicy = {
  id: 'policy-1',
  name: 'Sepolia agent allowance',
  mode: 'bounded-auto',
  walletId: 'wallet-1',
  workspaceId: 'workspace-1',
  networkIds: ['11155111'],
  origins: ['https://dapp.example'],
  destinations: ['0x0000000000000000000000000000000000000002'],
  methods: ['transfer'],
  maxNativeAmount: '1',
  maxTokenAmount: '100',
  maxFee: '0.01',
  sessionSpendLimit: '2',
  dailySpendLimit: '5',
  expiresAt: '2026-08-29T12:00:00.000Z',
  maximumOperationCount: 5,
  requireSuccessfulSimulation: true,
  allowMessageSigning: false
}

describe('WalletPermissionStore', () => {
  it('defaults to deny and scopes grants to wallet, workspace, origin, account, chain, and capability', async () => {
    const store = await permissionStore()
    const scope = {
      walletId: 'wallet-1',
      workspaceId: 'workspace-1',
      origin: 'https://dapp.example/path',
      account: wallet.publicAddress,
      chainFamily: 'evm' as const,
      networkId: '11155111',
      capabilities: ['read', 'sign'] as const,
      expiresAt: '2026-08-29T12:00:00.000Z'
    }

    expect(store.allows({ ...scope, origin: 'https://dapp.example', capability: 'read' }, new Date('2026-08-28'))).toBe(false)
    await store.grant(scope)

    expect(store.allows({ ...scope, origin: 'https://dapp.example', capability: 'sign' }, new Date('2026-08-28'))).toBe(true)
    expect(store.allows({ ...scope, origin: 'https://other.example', capability: 'sign' }, new Date('2026-08-28'))).toBe(false)
    expect(store.allows({ ...scope, origin: 'https://dapp.example', workspaceId: 'workspace-2', capability: 'sign' }, new Date('2026-08-28'))).toBe(false)
    expect(store.allows({ ...scope, origin: 'https://dapp.example', walletId: 'wallet-2', capability: 'sign' }, new Date('2026-08-28'))).toBe(false)
    expect(store.allows({ ...scope, origin: 'https://dapp.example', capability: 'send' }, new Date('2026-08-28'))).toBe(false)
    expect(store.allows({ ...scope, origin: 'https://dapp.example', capability: 'read' }, new Date('2026-08-30'))).toBe(false)
  })

  it('rejects iframe-attributed and non-normalized origin grants', async () => {
    const store = await permissionStore()
    await expect(store.grant({
      walletId: 'wallet-1', workspaceId: 'workspace-1', origin: 'https://dapp.example',
      account: wallet.publicAddress, chainFamily: 'evm', networkId: '1', capabilities: ['read'],
      expiresAt: '2026-08-29T12:00:00.000Z', frameOrigin: 'https://unsafe-frame.example'
    })).rejects.toThrow('Cross-origin iframe wallet grants are not allowed')
    await expect(store.grant({
      walletId: 'wallet-1', workspaceId: 'workspace-1', origin: 'file:///tmp/dapp.html',
      account: wallet.publicAddress, chainFamily: 'evm', networkId: '1', capabilities: ['read'],
      expiresAt: '2026-08-29T12:00:00.000Z'
    })).rejects.toThrow('Wallet permission origin must be HTTP or HTTPS')
  })

  it('revokes all grants for a wallet or workspace', async () => {
    const store = await permissionStore()
    await store.grant({
      walletId: 'wallet-1', workspaceId: 'workspace-1', origin: 'https://dapp.example',
      account: wallet.publicAddress, chainFamily: 'evm', networkId: '1', capabilities: ['read'],
      expiresAt: '2026-08-29T12:00:00.000Z'
    })
    expect(await store.revokeForWorkspace('workspace-1')).toBe(1)
    expect(store.list()).toEqual([])
  })
})

describe('WalletPolicyEngine', () => {
  const decoded = {
    understood: true,
    destination: '0x0000000000000000000000000000000000000002',
    method: 'transfer',
    nativeAmount: '0.5',
    tokenAmount: '10',
    estimatedFee: '0.001',
    unlimitedAllowance: false,
    newContractOrProgram: false,
    blindMessage: false
  }
  const simulation = { attempted: true, success: true }

  it('requires human approval for every mainnet sign or send despite a matching bounded policy', () => {
    const decision = new WalletPolicyEngine().evaluate({
      request: request({ networkId: '1' }),
      wallet: { ...wallet, network: { ...wallet.network, id: '1', environment: 'mainnet' } },
      policies: [{ ...policy, networkIds: ['1'] }], decoded, simulation,
      now: new Date('2026-08-28T12:10:00.000Z'), sessionSpend: '0', dailySpend: '0', operationCount: 0
    })
    expect(decision).toEqual({ outcome: 'awaiting-human', reason: 'mainnet-requires-human' })
  })

  it('allows narrowly bounded automatic approval on a matching testnet request', () => {
    const decision = new WalletPolicyEngine().evaluate({
      request: request(), wallet, policies: [policy], decoded, simulation,
      now: new Date('2026-08-28T12:10:00.000Z'), sessionSpend: '0.5', dailySpend: '1', operationCount: 2
    })
    expect(decision).toEqual({ outcome: 'approved', reason: 'bounded-policy', policyId: 'policy-1' })
  })

  it('does not trust a user-selected testnet label for known mainnet or unknown networks', () => {
    const engine = new WalletPolicyEngine()
    for (const networkId of ['1', '123456789']) {
      const decision = engine.evaluate({
        request: request({ networkId }),
        wallet: { ...wallet, network: { ...wallet.network, id: networkId, environment: 'testnet' } },
        policies: [{ ...policy, networkIds: [networkId] }], decoded, simulation,
        now: new Date('2026-08-28T12:10:00.000Z'), sessionSpend: '0', dailySpend: '0', operationCount: 0
      })
      expect(decision).toEqual({ outcome: 'awaiting-human', reason: 'network-not-eligible-for-automation' })
    }
  })

  it.each([
    ['solana', 'devnet'],
    ['tron', 'shasta']
  ] as const)('requires human approval for %s testnets until the RPC network is independently attested', (chainFamily, networkId) => {
    const decision = new WalletPolicyEngine().evaluate({
      request: request({ chainFamily, networkId }),
      wallet: {
        ...wallet,
        chainFamily,
        network: { ...wallet.network, id: networkId, name: networkId, environment: 'testnet' }
      },
      policies: [{ ...policy, networkIds: [networkId] }], decoded, simulation,
      now: new Date('2026-08-28T12:10:00.000Z'), sessionSpend: '0', dailySpend: '0', operationCount: 0
    })
    expect(decision).toEqual({ outcome: 'awaiting-human', reason: 'network-not-eligible-for-automation' })
  })

  it.each([
    ['failed simulation', { simulation: { attempted: true, success: false } }, 'simulation-required'],
    ['unknown transaction', { decoded: { ...decoded, understood: false } }, 'unknown-transaction'],
    ['unlimited allowance', { decoded: { ...decoded, unlimitedAllowance: true } }, 'unlimited-allowance'],
    ['new contract', { decoded: { ...decoded, newContractOrProgram: true } }, 'new-contract-or-program'],
    ['expired policy', { now: new Date('2026-08-30T12:00:00.000Z') }, 'no-matching-policy'],
    ['amount over limit', { decoded: { ...decoded, nativeAmount: '1.1' } }, 'no-matching-policy'],
    ['fee over limit', { decoded: { ...decoded, estimatedFee: '0.02' } }, 'no-matching-policy'],
    ['operation count exhausted', { operationCount: 5 }, 'no-matching-policy']
  ] as const)('requires a human for %s', (_label, override, reason) => {
    const decision = new WalletPolicyEngine().evaluate({
      request: request(), wallet, policies: [policy], decoded, simulation,
      now: new Date('2026-08-28T12:10:00.000Z'), sessionSpend: '0', dailySpend: '0', operationCount: 0,
      ...override
    })
    expect(decision).toEqual({ outcome: 'awaiting-human', reason })
  })

  it('always requires a human for blind message signing', () => {
    const decision = new WalletPolicyEngine().evaluate({
      request: request({ operation: 'sign-message' }), wallet,
      policies: [{ ...policy, allowMessageSigning: true }],
      decoded: { ...decoded, blindMessage: true }, simulation,
      now: new Date('2026-08-28T12:10:00.000Z'), sessionSpend: '0', dailySpend: '0', operationCount: 0
    })
    expect(decision).toEqual({ outcome: 'awaiting-human', reason: 'blind-message' })
  })
})
