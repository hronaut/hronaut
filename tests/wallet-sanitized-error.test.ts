import { describe, expect, it } from 'vitest'
import { HttpRequestError, RpcRequestError, TimeoutError } from 'viem'
import { sanitizedError, WALLET_RPC_UNAVAILABLE } from '../src/main/wallet/broker/sanitized-error.js'

describe('sanitizedError', () => {
  it('says the RPC endpoint is unavailable, without naming it, when the node cannot be reached', () => {
    const url = 'http://127.0.0.1:8545'
    const refused = new HttpRequestError({ url, details: 'fetch failed', cause: new Error('connect ECONNREFUSED 127.0.0.1:8545') })
    expect(sanitizedError(refused).message).toBe(WALLET_RPC_UNAVAILABLE)
    expect(sanitizedError(new TimeoutError({ body: { method: 'eth_call' }, url })).message).toBe(WALLET_RPC_UNAVAILABLE)
    // viem wraps the transport error in the error of the action that used it.
    expect(sanitizedError(new Error('Estimate gas failed', { cause: refused })).message).toBe(WALLET_RPC_UNAVAILABLE)
    expect(WALLET_RPC_UNAVAILABLE).not.toContain('127.0.0.1')
  })

  it('keeps treating a node that answered with an error as before', () => {
    const answered = new RpcRequestError({ body: { method: 'eth_call' }, error: { code: -32000, message: 'execution reverted' }, url: 'http://127.0.0.1:8545' })
    expect(sanitizedError(answered).message).toBe('Wallet request failed validation or processing')
    expect(sanitizedError(new Error('Wallet request was rejected by the user')).message).toBe('Wallet request was rejected by the user')
  })
})
