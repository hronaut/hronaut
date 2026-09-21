const NAMED_TRON_CHAIN_IDS: Readonly<Record<string, string>> = Object.freeze({
  mainnet: '0x2b6653dc',
  nile: '0xcd8690dc',
  shasta: '0x94a9059e'
})

const MAX_CHAIN_ID = (1n << 256n) - 1n

export function tronProviderChainId(networkId: string): string | undefined {
  const named = NAMED_TRON_CHAIN_IDS[networkId.toLowerCase()]
  if (named) return named
  return normalizeTronProviderChainId(networkId)
}

export function normalizeTronProviderChainId(chainId: string): string | undefined {
  if (!/^(?:0|[1-9][0-9]{0,77})$/.test(chainId)
    && !/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]{0,63})$/.test(chainId)) return undefined
  try {
    const value = BigInt(chainId)
    return value <= MAX_CHAIN_ID ? `0x${value.toString(16)}` : undefined
  } catch {
    return undefined
  }
}
