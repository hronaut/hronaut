/** What a page or agent gets when the wallet network's RPC endpoint does not answer, without naming the endpoint. */
export const WALLET_RPC_UNAVAILABLE = 'Wallet network RPC endpoint is unavailable; try again, or check the wallet\'s RPC endpoint in Hronaut'

// viem's errors for an endpoint that did not answer, timed out or answered with an HTTP error.
const RPC_TRANSPORT_ERRORS: ReadonlySet<string> = new Set(['HttpRequestError', 'TimeoutError', 'WebSocketRequestError', 'SocketClosedError'])

/** Whether the error, or one it wraps, says the RPC endpoint could not be used at all, rather than that the node refused a call. */
function isRpcTransportFailure(error: unknown): boolean {
  let current: unknown = error
  for (let depth = 0; depth < 8 && current instanceof Error; depth += 1) {
    if (RPC_TRANSPORT_ERRORS.has(current.name)) return true
    current = current.cause
  }
  return false
}

/**
 * The error a page or agent gets from the wallet broker: it keeps only known
 * wallet messages and replaces anything else, including any message that
 * names an RPC endpoint, with a generic one.
 */
export function sanitizedError(error: unknown): Error {
  if (isRpcTransportFailure(error)) return new Error(WALLET_RPC_UNAVAILABLE)
  const message = error instanceof Error ? error.message : 'Wallet request failed'
  const containsEndpoint = /(?:https?|wss?):\/\//i.test(message)
  const safe = !containsEndpoint
    && /^(?:Wallet|EVM|Solana|Tron|Requested|Unsupported|No wallet|Managed wallet|Watch-only|Invalid wallet|Cross-origin|Mainnet|Automatic wallet|Signed (?:EVM|Solana|Tron)|Transaction|Insufficient)[A-Za-z0-9_ .,:'"()/-]{0,480}$/.test(message)
    ? message
    : 'Wallet request failed validation or processing'
  return new Error(safe.slice(0, 512))
}
