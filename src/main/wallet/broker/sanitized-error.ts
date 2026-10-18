/**
 * The error a page or agent gets from the wallet broker: it keeps only known
 * wallet messages and replaces anything else, including any message that
 * names an RPC endpoint, with a generic one.
 */
export function sanitizedError(error: unknown): Error {
  const message = error instanceof Error ? error.message : 'Wallet request failed'
  const containsEndpoint = /(?:https?|wss?):\/\//i.test(message)
  const safe = !containsEndpoint
    && /^(?:Wallet|EVM|Solana|Tron|Requested|Unsupported|No wallet|Managed wallet|Watch-only|Invalid wallet|Cross-origin|Mainnet|Automatic wallet|Signed (?:EVM|Solana|Tron)|Transaction|Insufficient)[A-Za-z0-9_ .,:'"()/-]{0,480}$/.test(message)
    ? message
    : 'Wallet request failed validation or processing'
  return new Error(safe.slice(0, 512))
}
