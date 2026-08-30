import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { WalletPolicyUsageStore } from '../src/main/wallet/policy-usage.js'
import type { WalletPolicy } from '../src/shared/wallet.js'
import { createTestWalletAuthority, loadTestWalletAuthority } from './helpers/wallet-authority.js'

const directories: string[] = []
afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

async function store(): Promise<{ directory: string; value: WalletPolicyUsageStore }> {
  const directory = await mkdtemp(join(tmpdir(), 'hronaut-wallet-policy-usage-'))
  directories.push(directory)
  const value = new WalletPolicyUsageStore(await createTestWalletAuthority(directory))
  await value.load()
  return { directory, value }
}

function policy(overrides: Partial<WalletPolicy> = {}): WalletPolicy {
  return {
    id: 'policy-1', name: 'Bounded testnet', mode: 'bounded-auto', walletId: 'wallet-1',
    workspaceId: 'workspace-1', networkIds: ['11155111'], origins: ['https://dapp.example'],
    destinations: ['0x0000000000000000000000000000000000000002'], methods: ['native-transfer'],
    maxNativeAmount: '1', sessionSpendLimit: '1', dailySpendLimit: '1',
    expiresAt: '2027-08-28T12:00:00.000Z', maximumOperationCount: 1,
    requireSuccessfulSimulation: true, allowMessageSigning: false,
    ...overrides
  }
}

describe('WalletPolicyUsageStore', () => {
  it('atomically allows only one concurrent reservation at the configured operation limit', async () => {
    const { value } = await store()
    const now = new Date('2026-08-28T12:00:00.000Z')

    const results = await Promise.all([
      value.reserve(policy(), '0.75', now),
      value.reserve(policy(), '0.75', now)
    ])

    expect(results.filter((result) => result.reserved)).toHaveLength(1)
    expect(results.filter((result) => !result.reserved)).toEqual([
      { reserved: false, reason: 'operation-limit' }
    ])
  })

  it('persists lifetime operation and daily spend while resetting session usage after restart', async () => {
    const { directory, value } = await store()
    const now = new Date('2026-08-28T12:00:00.000Z')
    await expect(value.reserve(policy({ maximumOperationCount: 5, sessionSpendLimit: '2', dailySpendLimit: '2' }), '0.5', now))
      .resolves.toMatchObject({ reserved: true })

    const restarted = new WalletPolicyUsageStore(await loadTestWalletAuthority(directory))
    await restarted.load()
    expect(restarted.snapshot('policy-1', now)).toEqual({
      operationCount: 1,
      sessionOperationCount: 0,
      sessionSpend: '0',
      dailySpend: '0.5'
    })
  })

  it('resets only the daily bucket on the next UTC date', async () => {
    const { value } = await store()
    await value.reserve(policy({ maximumOperationCount: 5 }), '0.75', new Date('2026-08-28T23:59:59.000Z'))

    expect(value.snapshot('policy-1', new Date('2026-08-29T00:00:01.000Z'))).toMatchObject({
      operationCount: 1,
      sessionSpend: '0.75',
      dailySpend: '0'
    })
  })
})
