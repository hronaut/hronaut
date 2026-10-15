import { describe, expect, it } from 'vitest'
import { EvmFilterRegistry, MAX_EVM_FILTER_PAGES, MAX_EVM_FILTERS_PER_PAGE, type EvmFilterOwner } from '../src/main/wallet/evm-filters.js'

function owner(overrides: Partial<EvmFilterOwner> = {}): EvmFilterOwner {
  return {
    workspaceId: 'workspace-1', tabId: 'tab-1', navigationGeneration: 1, topLevelOrigin: 'https://dapp.example',
    networkId: '31337', rpcUrl: 'http://127.0.0.1:8545', ...overrides
  }
}

describe('EVM filter registry', () => {
  it('keeps a filter for the page document and node that created it', () => {
    const filters = new EvmFilterRegistry()
    filters.add(owner(), '0xAB')
    expect(filters.owns(owner(), '0xab')).toBe(true)
    expect(filters.owns(owner(), '0xAB')).toBe(true)
    expect(filters.owns(owner({ navigationGeneration: 2 }), '0xab')).toBe(false)
    expect(filters.owns(owner({ networkId: '1' }), '0xab')).toBe(false)
    expect(filters.owns(owner({ rpcUrl: 'http://127.0.0.1:9545' }), '0xab')).toBe(false)
    expect(filters.owns(owner(), 1)).toBe(false)
    filters.remove(owner(), '0xab')
    expect(filters.owns(owner(), '0xab')).toBe(false)
  })

  it('ignores a node answer that is not a filter ID', () => {
    const filters = new EvmFilterRegistry()
    for (const id of [null, 7, '', '0x', 'filter', `0x${'1'.repeat(65)}`]) filters.add(owner(), id)
    expect(filters.owns(owner(), '0x')).toBe(false)
    expect(filters.owns(owner(), 'filter')).toBe(false)
  })

  it('forgets the oldest filter of a page and the least recently used page beyond its limits', () => {
    const filters = new EvmFilterRegistry()
    for (let index = 1; index <= MAX_EVM_FILTERS_PER_PAGE + 1; index += 1) filters.add(owner(), `0x${index.toString(16)}`)
    expect(filters.owns(owner(), '0x1')).toBe(false)
    expect(filters.owns(owner(), '0x2')).toBe(true)
    expect(filters.owns(owner(), `0x${(MAX_EVM_FILTERS_PER_PAGE + 1).toString(16)}`)).toBe(true)

    for (let tab = 2; tab <= MAX_EVM_FILTER_PAGES; tab += 1) filters.add(owner({ tabId: `tab-${tab}` }), '0x1')
    // Polling tab-1 keeps it; tab-2 becomes the least recently used page.
    expect(filters.owns(owner(), '0x2')).toBe(true)
    filters.add(owner({ tabId: 'tab-new' }), '0x1')
    expect(filters.owns(owner(), '0x2')).toBe(true)
    expect(filters.owns(owner({ tabId: 'tab-2' }), '0x1')).toBe(false)
    expect(filters.owns(owner({ tabId: 'tab-3' }), '0x1')).toBe(true)
    expect(filters.owns(owner({ tabId: 'tab-new' }), '0x1')).toBe(true)
  })

  it('clears the filters of closed tabs, old documents and removed workspaces', () => {
    const filters = new EvmFilterRegistry()
    filters.add(owner(), '0x1')
    filters.add(owner({ tabId: 'tab-2' }), '0x1')
    filters.add(owner({ workspaceId: 'workspace-2', tabId: 'tab-3' }), '0x1')
    filters.clear((entry) => entry.tabId === 'tab-1' && entry.navigationGeneration < 2)
    expect(filters.owns(owner(), '0x1')).toBe(false)
    expect(filters.owns(owner({ tabId: 'tab-2' }), '0x1')).toBe(true)
    filters.clear((entry) => entry.workspaceId === 'workspace-2')
    expect(filters.owns(owner({ workspaceId: 'workspace-2', tabId: 'tab-3' }), '0x1')).toBe(false)
  })
})
