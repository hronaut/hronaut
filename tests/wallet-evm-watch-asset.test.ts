import { describe, expect, it } from 'vitest'
import {
  EvmAssetSuggestionLog,
  MAX_EVM_ASSET_SUGGESTION_TABS,
  MAX_EVM_ASSET_SUGGESTIONS_PER_TAB,
  parseWatchAsset,
  watchAssetRefusal,
  withHiddenWalletAddresses
} from '../src/main/wallet/evm-watch-asset.js'

const USDC = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'
const USDC_CHECKSUM = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
const page = { workspaceId: 'workspace-1', tabId: 'tab-1', topLevelOrigin: 'https://dapp.example' }

function codeOf(run: () => unknown): string | undefined {
  try {
    run()
  } catch (error) {
    return /^EVM RPC error \(code (-?\d+)\): wallet_watchAsset [A-Za-z0-9 .,]+$/.exec((error as Error).message)?.[1]
  }
  return undefined
}

describe('EIP-747 token suggestions', () => {
  it('reads the token details a dApp offers, as viem and MetaMask send them', () => {
    expect(parseWatchAsset({ type: 'ERC20', options: { address: USDC, symbol: 'USDC', decimals: 6, image: 'https://tokens.example/usdc.png' } }))
      .toEqual({ type: 'ERC20', address: USDC_CHECKSUM, symbol: 'USDC', decimals: 6, image: 'https://tokens.example/usdc.png' })
    // Older dApps wrap the request in an array and send decimals as text; symbol and decimals may be left out.
    expect(parseWatchAsset([{ type: 'ERC20', options: { address: USDC.toUpperCase().replace('0X', '0x'), decimals: '18' } }]))
      .toEqual({ type: 'ERC20', address: USDC_CHECKSUM, decimals: 18 })
    expect(parseWatchAsset({ type: 'ERC20', options: { address: USDC, symbol: 'USD₮0' } })).toMatchObject({ symbol: 'USD₮0' })
    expect(parseWatchAsset({ type: 'ERC20', options: { address: USDC, symbol: 'Wrapped E' } })).toMatchObject({ symbol: 'Wrapped E' })
    // Like MetaMask, empty values count as left out, and NFTs have no symbol or decimals.
    expect(parseWatchAsset({ type: 'ERC20', options: { address: USDC, symbol: '', decimals: null } })).toEqual({ type: 'ERC20', address: USDC_CHECKSUM })
    expect(parseWatchAsset({ type: 'ERC721', options: { address: USDC, tokenId: '0xff', symbol: 'TOO LONG FOR A TOKEN', decimals: 99 } }))
      .toEqual({ type: 'ERC721', address: USDC_CHECKSUM, tokenId: '255' })
    expect(parseWatchAsset({ type: 'ERC1155', options: { address: USDC, tokenId: '42' } })).toMatchObject({ type: 'ERC1155', tokenId: '42' })
  })

  it('keeps only a plain web image link, without its query string', () => {
    const image = (value: unknown) => parseWatchAsset({ type: 'ERC20', options: { address: USDC, image: value } })
    expect(image('https://cdn.example/usdc.png?X-Amz-Signature=secret#logo')).toMatchObject({ image: 'https://cdn.example/usdc.png' })
    expect(image('data:image/png;base64,AAAA')).toMatchObject({ imageOmitted: true })
    expect(image('https://user:secret@tokens.example/usdc.png')).toMatchObject({ imageOmitted: true })
    expect(image('https://user:secret@tokens.example/usdc.png')).not.toHaveProperty('image')
    expect(image(`https://tokens.example/${'a'.repeat(600)}.png`)).toMatchObject({ imageOmitted: true })
    expect(image('javascript:alert(1)')).toMatchObject({ imageOmitted: true })
    expect(image(42)).toMatchObject({ imageOmitted: true })
  })

  it('refuses malformed suggestions with code -32602, and characters that would hide what the symbol says', () => {
    const asset = (options: Record<string, unknown>, type: unknown = 'ERC20') => () => parseWatchAsset({ type, options: { address: USDC, ...options } })
    expect(codeOf(() => parseWatchAsset(undefined))).toBe('-32602')
    expect(codeOf(asset({}, 'ERC777'))).toBe('-32602')
    expect(codeOf(asset({ address: '0x1234' }))).toBe('-32602')
    expect(codeOf(asset({ address: undefined }))).toBe('-32602')
    expect(codeOf(asset({ symbol: 'TWELVECHARSS' }))).toBe('-32602')
    // MetaMask counts UTF-16 units: six emoji are twelve.
    expect(codeOf(asset({ symbol: '\u{1FA99}'.repeat(6) }))).toBe('-32602')
    expect(codeOf(asset({ symbol: 7 }))).toBe('-32602')
    expect(codeOf(asset({ symbol: 'USD‮C' }))).toBe('-32602')
    expect(codeOf(asset({ symbol: 'USD\nC' }))).toBe('-32602')
    expect(codeOf(asset({ decimals: 37 }))).toBe('-32602')
    expect(codeOf(asset({ decimals: 1.5 }))).toBe('-32602')
    expect(codeOf(asset({ decimals: '6.0' }))).toBe('-32602')
    expect(codeOf(asset({}, 'ERC721'))).toBe('-32602')
    expect(codeOf(asset({ tokenId: 7 }, 'ERC721'))).toBe('-32602')
    expect(codeOf(asset({ tokenId: '-1' }, 'ERC1155'))).toBe('-32602')
    expect(codeOf(asset({ tokenId: (1n << 256n).toString() }, 'ERC1155'))).toBe('-32602')
  })

  it('refuses an ERC-20 suggestion that disagrees with its contract, as MetaMask does', () => {
    const asset = (options: Record<string, unknown>) => parseWatchAsset({ type: 'ERC20', options: { address: USDC, ...options } })
    const reason = (options: Record<string, unknown>, contract: { symbol?: string; decimals?: number }) => watchAssetRefusal(asset(options), contract)?.reason
    expect(reason({ symbol: 'usdc', decimals: 6 }, { symbol: 'USDC', decimals: 6 })).toBeUndefined()
    expect(reason({}, { symbol: 'USDC', decimals: 6 })).toBeUndefined()
    // A contract that cannot be read leaves the page's values unchecked.
    expect(reason({ symbol: 'USDC', decimals: 6 }, {})).toBeUndefined()
    expect(reason({ symbol: 'USDT', decimals: 6 }, { symbol: 'USDC', decimals: 6 })).toBe('symbol-mismatch')
    expect(reason({ symbol: 'USDC', decimals: 18 }, { symbol: 'USDC', decimals: 6 })).toBe('decimals-mismatch')
    expect(reason({ decimals: 6 }, {})).toBe('symbol-missing')
    expect(reason({ symbol: 'USDC' }, {})).toBe('decimals-missing')
    expect(watchAssetRefusal(asset({ symbol: 'USDC', decimals: 18 }), { decimals: 6 })?.error.message)
      .toBe('EVM RPC error (code -32602): wallet_watchAsset decimals 18 do not match the token contract decimals 6')
    expect(watchAssetRefusal(parseWatchAsset({ type: 'ERC721', options: { address: USDC, tokenId: '1' } }), {})).toBeUndefined()
  })

  it('hides a wallet address the agent may not see yet', () => {
    const wallet = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'
    const entry = { type: 'ERC20' as const, address: USDC_CHECKSUM, networkId: '1', suggestedAt: '2026-10-15T20:00:00.000Z' }
    expect(withHiddenWalletAddresses({ ...entry, address: wallet, image: `https://x.example/${wallet.slice(2).toLowerCase()}.png` }, [wallet], 'hidden'))
      .toEqual({ ...entry, address: 'hidden', imageOmitted: true })
    expect(withHiddenWalletAddresses({ ...entry, image: 'https://x.example/usdc.png' }, [wallet], 'hidden'))
      .toEqual({ ...entry, image: 'https://x.example/usdc.png' })
  })

  it('remembers the newest suggestions of each site in a tab and forgets a closed tab', () => {
    const log = new EvmAssetSuggestionLog()
    const entry = (symbol: string) => ({ type: 'ERC20' as const, address: USDC_CHECKSUM, symbol, networkId: '1', suggestedAt: '2026-10-15T20:00:00.000Z' })
    for (let index = 0; index <= MAX_EVM_ASSET_SUGGESTIONS_PER_TAB; index += 1) log.add(page, entry(`T${index}`))
    log.add({ ...page, topLevelOrigin: 'https://next.example' }, entry('NEXT'))
    log.add({ ...page, tabId: 'tab-2' }, entry('OTHER'))

    const current = log.forPage(page)
    expect(current.map(({ symbol }) => symbol)).toEqual(Array.from({ length: MAX_EVM_ASSET_SUGGESTIONS_PER_TAB - 1 }, (_, index) => `T${index + 2}`))
    expect(log.forPage({ ...page, topLevelOrigin: 'https://next.example' }).map(({ symbol }) => symbol)).toEqual(['NEXT'])
    expect(log.forPage({ ...page, topLevelOrigin: 'https://other.example' })).toEqual([])
    expect(log.forPage({ ...page, workspaceId: 'workspace-2' })).toEqual([])
    current[0]!.symbol = 'CHANGED'
    expect(log.forPage(page)[0]!.symbol).toBe('T2')

    log.clear((entryPage) => entryPage.tabId === 'tab-1')
    expect(log.forPage(page)).toEqual([])
    expect(log.forPage({ ...page, tabId: 'tab-2' }).map(({ symbol }) => symbol)).toEqual(['OTHER'])
  })

  it('forgets the least recently used tab beyond the tab limit', () => {
    const log = new EvmAssetSuggestionLog()
    const entry = { type: 'ERC20' as const, address: USDC_CHECKSUM, networkId: '1', suggestedAt: '2026-10-15T20:00:00.000Z' }
    for (let index = 0; index < MAX_EVM_ASSET_SUGGESTION_TABS; index += 1) log.add({ ...page, tabId: `tab-${index}` }, entry)
    log.add({ ...page, tabId: 'tab-0' }, entry)
    log.add({ ...page, tabId: 'tab-new' }, entry)
    expect(log.forPage({ ...page, tabId: 'tab-1' })).toEqual([])
    expect(log.forPage({ ...page, tabId: 'tab-0' })).toHaveLength(2)
    expect(log.forPage({ ...page, tabId: 'tab-new' })).toHaveLength(1)
  })
})
