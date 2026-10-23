import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { WalletPolicyStore } from '../src/main/wallet/policy-store.js'
import type { WalletPolicy } from '../src/shared/wallet.js'
import { createTestWalletAuthority } from './helpers/wallet-authority.js'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

function policy(overrides: Partial<WalletPolicy>): WalletPolicy {
  return {
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
    allowMessageSigning: false,
    ...overrides
  }
}

describe('WalletPolicyStore', () => {
  // A policy saved by 2.45.0 or earlier with a token method and no token contract was kept, though it could never
  // approve a token call, so it looked active while every token call still asked for a click.
  it('drops saved policies that list a token method without a token contract, and saves the rest', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'hronaut-wallet-policy-store-'))
    temporaryDirectories.push(directory)
    const authority = await createTestWalletAuthority(directory)
    const kept = [
      policy({ id: 'native', methods: ['transfer'] }),
      policy({ id: 'listed-token', methods: ['erc20.transfer'], contracts: ['0x0000000000000000000000000000000000000003'] }),
      policy({ id: 'any-token', methods: ['erc20.transfer'], allowAnyTokenContract: true }),
      policy({ id: 'ask', mode: 'always-ask', methods: ['nft.transferFrom'] })
    ]
    await authority.mutate((state) => {
      state.policies = [...kept, policy({ id: 'legacy-token', methods: ['erc20.approve', 'transfer'] })]
    })

    const loaded = await new WalletPolicyStore(authority).load()

    expect(loaded.map((entry) => entry.id)).toEqual(['any-token', 'ask', 'listed-token', 'native'])
    expect(authority.snapshot().policies.map((entry) => entry.id).sort()).toEqual(['any-token', 'ask', 'listed-token', 'native'])
  })

  it('leaves the saved policies untouched when none needs dropping', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'hronaut-wallet-policy-store-'))
    temporaryDirectories.push(directory)
    const authority = await createTestWalletAuthority(directory)
    await authority.mutate((state) => { state.policies = [policy({ id: 'native' })] })
    const revision = authority.snapshot().revision

    await new WalletPolicyStore(authority).load()

    expect(authority.snapshot().revision).toBe(revision)
  })
})
