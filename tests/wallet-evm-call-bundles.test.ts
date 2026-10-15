import { describe, expect, it } from 'vitest'
import {
  callBundleStatus,
  callReceipt,
  EvmCallBundleStore,
  MAX_EVM_BUNDLE_CALLS,
  MAX_EVM_CALL_BUNDLES,
  MAX_EVM_CALL_BUNDLES_PER_SITE,
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

function started<T>(result: T | 'duplicate' | 'full'): T {
  if (result === 'duplicate' || result === 'full') throw new Error(`Expected a started bundle, got ${result}`)
  return result
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

  it('keeps a bundle ID per site and refuses to reuse it', () => {
    const store = new EvmCallBundleStore()
    const first = started(store.start(owner, wallet, 2, 'checkout-1'))
    expect(first.id).toBe('checkout-1')
    expect(store.start(owner, wallet, 2, 'checkout-1')).toBe('duplicate')
    first.bundle.finished = true
    expect(store.start(owner, wallet, 2, 'checkout-1')).toBe('duplicate')
    expect(store.get(owner, 'checkout-1')).toBe(first.bundle)
    expect(store.get({ ...owner, topLevelOrigin: 'https://other.example' }, 'checkout-1')).toBeUndefined()
    expect(store.get({ ...owner, workspaceId: 'workspace-2' }, 'checkout-1')).toBeUndefined()
    expect(started(store.start({ ...owner, topLevelOrigin: 'https://other.example' }, wallet, 1, 'checkout-1')).id).toBe('checkout-1')
    expect(started(store.start(owner, wallet, 1)).id).toMatch(/^0x[0-9a-f]{64}$/)
    store.clear((entry) => entry.topLevelOrigin === 'https://dapp.example')
    expect(started(store.start(owner, wallet, 1, 'checkout-1')).id).toBe('checkout-1')
  })

  it('forgets only finished bundles when a site reaches its limit, so a sending bundle keeps its ID', () => {
    const store = new EvmCallBundleStore()
    const sending = Array.from({ length: MAX_EVM_CALL_BUNDLES_PER_SITE }, (_, index) => started(store.start(owner, wallet, 1, `call-${index}`)))
    expect(store.start(owner, wallet, 1, 'one-more')).toBe('full')
    // Another site has its own limit.
    expect(started(store.start({ ...owner, topLevelOrigin: 'https://other.example' }, wallet, 1)).id).toMatch(/^0x/)

    sending[3]!.bundle.finished = true
    sending[7]!.bundle.finished = true
    expect(started(store.start(owner, wallet, 1, 'one-more')).id).toBe('one-more')
    // The oldest finished bundle was forgotten; every bundle still sending was kept.
    expect(store.get(owner, 'call-3')).toBeUndefined()
    expect(store.get(owner, 'call-7')).toBe(sending[7]!.bundle)
    expect(store.get(owner, 'call-0')).toBe(sending[0]!.bundle)
    expect(store.start(owner, wallet, 1, 'call-0')).toBe('duplicate')
  })

  it('forgets the oldest finished bundle across sites at the shared limit', () => {
    const store = new EvmCallBundleStore()
    const sites = MAX_EVM_CALL_BUNDLES / MAX_EVM_CALL_BUNDLES_PER_SITE
    const bundles = Array.from({ length: sites }, (_, site) => Array.from(
      { length: MAX_EVM_CALL_BUNDLES_PER_SITE },
      () => started(store.start({ ...owner, topLevelOrigin: `https://site-${site}.example` }, wallet, 1))
    )).flat()
    const newcomer = { ...owner, topLevelOrigin: 'https://newcomer.example' }
    expect(store.start(newcomer, wallet, 1)).toBe('full')

    bundles[40]!.bundle.finished = true
    expect(started(store.start(newcomer, wallet, 1, 'first')).id).toBe('first')
    expect(store.get({ ...owner, topLevelOrigin: 'https://site-1.example' }, bundles[40]!.id)).toBeUndefined()
    expect(store.get({ ...owner, topLevelOrigin: 'https://site-0.example' }, bundles[0]!.id)).toBe(bundles[0]!.bundle)
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
