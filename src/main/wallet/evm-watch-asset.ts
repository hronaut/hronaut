import { getAddress } from 'viem'
import { WalletPageLog } from './page-log.js'

/** Token suggestions remembered per tab for `wallet_page_requests`; the oldest is dropped first. */
export const MAX_EVM_ASSET_SUGGESTIONS_PER_TAB = 20
/** Tabs whose suggestions are remembered at once; closing a tab forgets its suggestions sooner. */
export const MAX_EVM_ASSET_SUGGESTION_TABS = 256
const MAX_IMAGE_URL_LENGTH = 512
const MAX_TOKEN_ID = (1n << 256n) - 1n

/** MetaMask allows 11 UTF-16 units; Hronaut also refuses control, invisible formatting and line break characters. */
const MAX_SYMBOL_LENGTH = 11
const SYMBOL = /^[^\p{C}\p{Zl}\p{Zp}]+$/u
const TOKEN_ID = /^(?:0|[1-9]\d{0,77}|0x[0-9a-fA-F]{1,64})$/

export type EvmAssetType = 'ERC20' | 'ERC721' | 'ERC1155'

/** The token details a page offered with EIP-747 `wallet_watchAsset`. */
export interface EvmAssetSuggestion {
  type: EvmAssetType
  address: string
  symbol?: string
  decimals?: number
  tokenId?: string
  /** The image link without its query string or fragment. */
  image?: string
  /** The page sent an image Hronaut does not show, such as a data URL or one with sign-in details. */
  imageOmitted?: true
}

/** What the token contract itself reports; a value is missing when the contract does not answer. */
export interface EvmTokenContractDetails {
  symbol?: string
  decimals?: number
}

export type EvmAssetRefusal = 'symbol-missing' | 'symbol-mismatch' | 'decimals-missing' | 'decimals-mismatch'

function invalid(message: string): Error {
  return new Error(`EVM RPC error (code -32602): ${message}`)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/**
 * Reads a `wallet_watchAsset` request the way MetaMask accepts it: params is
 * the `{ type, options }` object, or an array holding it. An ERC-20 symbol and
 * decimals may be left out, as in current MetaMask, which then reads them from
 * the contract; NFTs have neither.
 */
export function parseWatchAsset(params: unknown): EvmAssetSuggestion {
  const request = Array.isArray(params) ? params[0] : params
  const type = isRecord(request) ? request.type : undefined
  if (type !== 'ERC20' && type !== 'ERC721' && type !== 'ERC1155') {
    throw invalid('wallet_watchAsset accepts only ERC20, ERC721 and ERC1155 assets')
  }
  const options = isRecord(request) && isRecord(request.options) ? request.options : {}
  if (typeof options.address !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(options.address)) {
    throw invalid('wallet_watchAsset needs options.address, the token contract address')
  }
  const asset: EvmAssetSuggestion = { type, address: getAddress(options.address.toLowerCase()) }
  // Like MetaMask, an empty value counts as left out.
  if (type === 'ERC20' && options.symbol !== undefined && options.symbol !== null && options.symbol !== '') {
    if (typeof options.symbol !== 'string' || options.symbol.length > MAX_SYMBOL_LENGTH || !SYMBOL.test(options.symbol)) {
      throw invalid('wallet_watchAsset symbol must be at most 11 characters, without control or invisible characters')
    }
    asset.symbol = options.symbol
  }
  if (type === 'ERC20' && options.decimals !== undefined && options.decimals !== null && options.decimals !== '') {
    const decimals = typeof options.decimals === 'string' && /^\d{1,2}$/.test(options.decimals)
      ? Number(options.decimals)
      : options.decimals
    if (typeof decimals !== 'number' || !Number.isInteger(decimals) || decimals < 0 || decimals > 36) {
      throw invalid('wallet_watchAsset decimals must be a whole number from 0 to 36')
    }
    asset.decimals = decimals
  }
  if (type !== 'ERC20') {
    const tokenId = typeof options.tokenId === 'string' && TOKEN_ID.test(options.tokenId) ? BigInt(options.tokenId) : undefined
    if (tokenId === undefined || tokenId > MAX_TOKEN_ID) {
      throw invalid('wallet_watchAsset needs options.tokenId for ERC721 and ERC1155 assets')
    }
    asset.tokenId = tokenId.toString()
  }
  if (options.image !== undefined) {
    const image = imageUrl(options.image)
    if (image) asset.image = image
    else asset.imageOmitted = true
  }
  return asset
}

function imageUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > MAX_IMAGE_URL_LENGTH) return undefined
  try {
    const url = new URL(value)
    if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.username || url.password) return undefined
    // A query string can carry a signed download token.
    const link = `${url.origin}${url.pathname}`
    return link.length <= MAX_IMAGE_URL_LENGTH ? link : undefined
  } catch {
    return undefined
  }
}

/**
 * MetaMask reads an ERC-20 suggestion's symbol and decimals from the contract
 * and refuses one that disagrees, or that leaves a value out when the
 * contract does not report it. Hronaut refuses the same suggestions, so a
 * dApp's "Add token" button that offers the wrong details fails here as it
 * would for its users.
 */
export function watchAssetRefusal(
  asset: EvmAssetSuggestion,
  contract: EvmTokenContractDetails
): { reason: EvmAssetRefusal; error: Error } | undefined {
  if (asset.type !== 'ERC20') return undefined
  if (asset.symbol === undefined && contract.symbol === undefined) {
    return { reason: 'symbol-missing', error: invalid('wallet_watchAsset needs a symbol, and the token contract does not report one') }
  }
  if (asset.symbol !== undefined && contract.symbol !== undefined && asset.symbol.toUpperCase() !== contract.symbol.toUpperCase()) {
    return { reason: 'symbol-mismatch', error: invalid('wallet_watchAsset symbol does not match the symbol of the token contract') }
  }
  if (asset.decimals === undefined && contract.decimals === undefined) {
    return { reason: 'decimals-missing', error: invalid('wallet_watchAsset needs decimals, and the token contract does not report them') }
  }
  if (asset.decimals !== undefined && contract.decimals !== undefined && asset.decimals !== contract.decimals) {
    return {
      reason: 'decimals-mismatch',
      error: invalid(`wallet_watchAsset decimals ${asset.decimals} do not match the token contract decimals ${contract.decimals}`)
    }
  }
  return undefined
}

/**
 * Replaces a wallet address the agent may not see yet, the same way wallet
 * request details do, in case a page put the account in its suggestion.
 */
export function withHiddenWalletAddresses(
  entry: EvmAssetSuggestionEntry,
  hiddenAddresses: string[],
  label: string
): EvmAssetSuggestionEntry {
  const hidden = hiddenAddresses.map((address) => address.toLowerCase().replace(/^0x/, ''))
  const result = { ...entry }
  if (hidden.includes(entry.address.toLowerCase().replace(/^0x/, ''))) result.address = label
  if (entry.image && hidden.some((address) => entry.image!.toLowerCase().includes(address))) {
    delete result.image
    result.imageOmitted = true
  }
  return result
}

export interface EvmAssetSuggestionEntry extends EvmAssetSuggestion {
  networkId: string
  suggestedAt: string
  contractSymbol?: string
  contractDecimals?: number
  /** Why Hronaut refused the suggestion, as MetaMask would. */
  refused?: EvmAssetRefusal
}

/** Token suggestions each tab's sites made; closing a tab forgets them. */
export class EvmAssetSuggestionLog extends WalletPageLog<EvmAssetSuggestionEntry> {
  constructor() {
    super(MAX_EVM_ASSET_SUGGESTIONS_PER_TAB, MAX_EVM_ASSET_SUGGESTION_TABS)
  }
}
