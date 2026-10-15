import { describe, expect, it, vi } from 'vitest'
import { EvmFilterRegistry, MAX_EVM_FILTER_PAGES, MAX_EVM_FILTERS_PER_PAGE, type EvmFilterOwner } from '../src/main/wallet/evm-filters.js'
import type { WalletDescriptor } from '../src/shared/wallet.js'

function wallet(rpcUrl = 'http://127.0.0.1:8545', id = '31337'): WalletDescriptor {
  return { network: { id, name: 'Local', environment: 'local', rpcUrl } } as WalletDescriptor
}

function owner(overrides: Partial<EvmFilterOwner> = {}): EvmFilterOwner {
  return { workspaceId: 'workspace-1', tabId: 'tab-1', topLevelOrigin: 'https://dapp.example', wallet: wallet(), ...overrides }
}

describe('EVM filter registry', () => {
  it('keeps a filter for the tab, site and node that created it', () => {
    const filters = new EvmFilterRegistry()
    expect(filters.add(owner(), '0xAB')).toBe(true)
    expect(filters.owns(owner(), '0xab')).toBe(true)
    expect(filters.owns(owner(), '0xAB')).toBe(true)
    // Another wallet on the same chain and RPC reaches the same node.
    expect(filters.owns(owner({ wallet: wallet() }), '0xab')).toBe(true)
    for (const other of [
      owner({ tabId: 'tab-2' }), owner({ workspaceId: 'workspace-2' }), owner({ topLevelOrigin: 'https://other.example' }),
      owner({ wallet: wallet('http://127.0.0.1:9545') }), owner({ wallet: wallet(undefined, '1') })
    ]) expect(filters.owns(other, '0xab')).toBe(false)
    expect(filters.owns(owner(), 1)).toBe(false)
    filters.remove(owner(), '0xab')
    expect(filters.owns(owner(), '0xab')).toBe(false)
  })

  it('refuses a filter beyond the page limit instead of forgetting one still in use', () => {
    const forget = vi.fn()
    const filters = new EvmFilterRegistry(forget)
    for (let index = 1; index <= MAX_EVM_FILTERS_PER_PAGE; index += 1) expect(filters.add(owner(), `0x${index.toString(16)}`)).toBe(true)
    expect(filters.isFull(owner())).toBe(true)
    expect(filters.add(owner(), '0xfff')).toBe(false)
    expect(filters.owns(owner(), '0xfff')).toBe(false)
    expect(filters.owns(owner(), '0x1')).toBe(true)
    expect(filters.isFull(owner({ tabId: 'tab-2' }))).toBe(false)
    filters.remove(owner(), '0x1')
    expect(filters.isFull(owner())).toBe(false)
    expect(forget).not.toHaveBeenCalled()
  })

  it('gives an ID a restarted node hands out again only to the page that just received it', () => {
    const filters = new EvmFilterRegistry()
    filters.add(owner(), '0x1')
    filters.add(owner({ tabId: 'tab-2' }), '0x1')
    expect(filters.owns(owner(), '0x1')).toBe(false)
    expect(filters.owns(owner({ tabId: 'tab-2' }), '0x1')).toBe(true)
    // The same ID from another node is a different filter.
    filters.add(owner({ tabId: 'tab-3', wallet: wallet('http://127.0.0.1:9545') }), '0x1')
    expect(filters.owns(owner({ tabId: 'tab-2' }), '0x1')).toBe(true)
  })

  it('forgets the least recently used page beyond the page limit and hands its filters back', () => {
    const forget = vi.fn()
    const filters = new EvmFilterRegistry(forget)
    filters.add(owner(), '0x1')
    for (let tab = 2; tab <= MAX_EVM_FILTER_PAGES; tab += 1) filters.add(owner({ tabId: `tab-${tab}`, wallet: wallet(`http://127.0.0.1:${tab}`) }), '0x1')
    // Polling tab-1 keeps it; tab-2 becomes the least recently used page.
    expect(filters.owns(owner(), '0x1')).toBe(true)
    filters.add(owner({ tabId: 'tab-new', wallet: wallet('http://127.0.0.1:1') }), '0x1')
    expect(filters.owns(owner(), '0x1')).toBe(true)
    expect(filters.owns(owner({ tabId: 'tab-2', wallet: wallet('http://127.0.0.1:2') }), '0x1')).toBe(false)
    expect(forget).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ tabId: 'tab-2' }), ['0x1'])
  })

  it('clears the filters of closed tabs and removed workspaces and hands them back', () => {
    const forget = vi.fn()
    const filters = new EvmFilterRegistry(forget)
    filters.add(owner(), '0x1')
    filters.add(owner(), '0x2')
    filters.add(owner({ tabId: 'tab-2' }), '0x3')
    filters.add(owner({ workspaceId: 'workspace-2', tabId: 'tab-3' }), '0x4')
    filters.clear((entry) => entry.tabId === 'tab-1')
    expect(forget).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ tabId: 'tab-1' }), ['0x1', '0x2'])
    expect(filters.owns(owner(), '0x1')).toBe(false)
    expect(filters.owns(owner({ tabId: 'tab-2' }), '0x3')).toBe(true)
    filters.clear((entry) => entry.workspaceId === 'workspace-2')
    expect(filters.owns(owner({ workspaceId: 'workspace-2', tabId: 'tab-3' }), '0x4')).toBe(false)
  })
})
