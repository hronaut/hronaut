import { describe, expect, it } from 'vitest'
import {
  callBundleStatus,
  callReceipt,
  EvmCallBundleStore,
  MAX_EVM_BUNDLE_CALLS,
  MAX_EVM_CALL_BUNDLES,
  parseSendCalls,
  type EvmCallBundle
} from '../src/main/wallet/evm-call-bundles.js'
import type { WalletDescriptor } from '../src/shared/wallet.js'

const wallet = { network: { id: '11155111' } } as WalletDescriptor
const owner = { workspaceId: 'workspace-1', topLevelOrigin: 'https://dapp.example' }
const call = { to: '0x0000000000000000000000000000000000000002', data: '0x', value: '0x1' }

function request(overrides: Record<string, unknown> = {}) {
  return [{ version: '2.0.0', chainId: '0xaa36a7', atomicRequired: false, calls: [call, call], ...overrides }]
}

function codeOf(run: () => unknown): string | undefined {
  try {
    run()
  } catch (error) {
    return /code (-?\d+)/.exec((error as Error).message)?.[1]
  }
  return undefined
}

describe('EIP-5792 batch calls', () => {
  it('accepts a non-atomic batch and optional capabilities', () => {
    expect(parseSendCalls(request({ capabilities: { paymasterService: { url: 'https://paymaster.example', optional: true } } })))
      .toMatchObject({ version: '2.0.0', chainId: '0xaa36a7', calls: [call, call] })
    // One call is atomic on its own.
    expect(parseSendCalls(request({ atomicRequired: true, calls: [call] })).calls).toHaveLength(1)
  })

  it('refuses what one-at-a-time transactions cannot honor with the EIP-5792 codes', () => {
    expect(codeOf(() => parseSendCalls(request({ atomicRequired: true })))).toBe('5760')
    expect(codeOf(() => parseSendCalls(request({ capabilities: { paymasterService: { url: 'https://paymaster.example' } } })))).toBe('5700')
    expect(codeOf(() => parseSendCalls(request({ calls: [{ ...call, capabilities: { auxiliaryFunds: { optional: false } } }] })))).toBe('5700')
    expect(codeOf(() => parseSendCalls(request({ calls: Array.from({ length: MAX_EVM_BUNDLE_CALLS + 1 }, () => call) })))).toBe('5740')
    expect(codeOf(() => parseSendCalls(request({ version: '1.0' })))).toBe('-32602')
    expect(codeOf(() => parseSendCalls(request({ calls: [] })))).toBe('-32602')
    expect(codeOf(() => parseSendCalls(request({ calls: [{ ...call, data: '0x1' }] })))).toBe('-32602')
    expect(codeOf(() => parseSendCalls([]))).toBe('-32602')
  })

  it('keeps a bundle ID per site and forgets the oldest bundle beyond the limit', () => {
    const store = new EvmCallBundleStore()
    const first = store.start(owner, wallet, 2, 'checkout-1')!
    expect(first.id).toBe('checkout-1')
    expect(store.start(owner, wallet, 2, 'checkout-1')).toBeUndefined()
    expect(store.get(owner, 'checkout-1')).toBe(first.bundle)
    expect(store.get({ ...owner, topLevelOrigin: 'https://other.example' }, 'checkout-1')).toBeUndefined()
    expect(store.get({ ...owner, workspaceId: 'workspace-2' }, 'checkout-1')).toBeUndefined()
    expect(store.start({ ...owner, topLevelOrigin: 'https://other.example' }, wallet, 1, 'checkout-1')).toBeDefined()
    expect(store.start(owner, wallet, 1)!.id).toMatch(/^0x[0-9a-f]{64}$/)

    for (let index = 0; index < MAX_EVM_CALL_BUNDLES; index += 1) store.start(owner, wallet, 1)
    expect(store.get(owner, 'checkout-1')).toBeUndefined()
    store.clear((entry) => entry.topLevelOrigin === 'https://dapp.example')
    expect(store.start(owner, wallet, 1, 'checkout-1')).toBeDefined()
  })

  it('reports pending until every sent call is mined, then confirmed, reverted or partly reverted', () => {
    const mined = (status: string) => callReceipt({ status, logs: [], blockHash: '0xb', blockNumber: '0x1', gasUsed: '0x5208', transactionHash: '0xt' })
    const bundle = (calls: number, sent: number, finished = true): EvmCallBundle => ({
      owner, wallet, calls, hashes: Array.from({ length: sent }, (_, index) => `0x${index}`), finished
    })
    expect(callBundleStatus(bundle(2, 1, false), [mined('0x1')])).toBe(100)
    expect(callBundleStatus(bundle(2, 2), [mined('0x1'), undefined])).toBe(100)
    expect(callBundleStatus(bundle(2, 2), [mined('0x1'), mined('0x1')])).toBe(200)
    expect(callBundleStatus(bundle(2, 2), [mined('0x0'), mined('0x0')])).toBe(500)
    expect(callBundleStatus(bundle(2, 2), [mined('0x1'), mined('0x0')])).toBe(600)
    // The second call was never sent, for example because the person rejected it.
    expect(callBundleStatus(bundle(2, 1), [mined('0x1')])).toBe(600)
  })

  it('keeps only the receipt fields EIP-5792 reports', () => {
    expect(callReceipt(null)).toBeUndefined()
    expect(callReceipt({
      status: '0x1', blockHash: '0xb', blockNumber: '0x1', gasUsed: '0x5208', transactionHash: '0xt', from: '0xf', cumulativeGasUsed: '0x9',
      logs: [{ address: '0xa', data: '0x', topics: ['0x1'], logIndex: '0x0' }]
    })).toEqual({
      status: '0x1', blockHash: '0xb', blockNumber: '0x1', gasUsed: '0x5208', transactionHash: '0xt',
      logs: [{ address: '0xa', data: '0x', topics: ['0x1'] }]
    })
  })
})
