import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  bridgeTransports,
  createRestrictedFetch,
  parseLoopbackEndpoint,
  resolveAuthenticationToken,
  type MessageTransport
} from '../scripts/mcpb-adapter.js'

class FakeTransport implements MessageTransport {
  onclose?: () => void
  onerror?: (error: Error) => void
  onmessage?: (message: JSONRPCMessage) => void
  readonly sent: JSONRPCMessage[] = []
  started = false
  closed = false
  protocolVersion: string | undefined

  async start(): Promise<void> { this.started = true }
  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    this.onclose?.()
  }
  async send(message: JSONRPCMessage): Promise<void> { this.sent.push(message) }
  setProtocolVersion(version: string): void { this.protocolVersion = version }
}

describe('MCPB adapter endpoint restrictions', () => {
  it.each([
    'http://127.0.0.1:47812/mcp',
    'http://127.42.0.9:9000/mcp',
    'http://localhost:47812/mcp',
    'https://[::1]:47812/mcp'
  ])('accepts a loopback endpoint: %s', (value) => {
    expect(parseLoopbackEndpoint(value).href).toBe(value)
  })

  it.each([
    'https://hronaut.example/mcp',
    'http://192.168.1.2/mcp',
    'file:///tmp/mcp',
    'http://user:secret@127.0.0.1/mcp',
    'http://127.0.0.1/mcp#token'
  ])('rejects an endpoint that can escape the local transport boundary: %s', (value) => {
    expect(() => parseLoopbackEndpoint(value)).toThrow()
  })

  it('blocks redirects and never follows a bearer token to another URL', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, {
      status: 302,
      headers: { location: 'https://attacker.example/collect' }
    }))
    const endpoint = new URL('http://127.0.0.1:47812/mcp')
    const restrictedFetch = createRestrictedFetch(endpoint, fetcher)

    await expect(restrictedFetch(endpoint, {
      headers: { authorization: 'Bearer private-token' }
    })).rejects.toThrow('does not follow upstream redirects')
    expect(fetcher).toHaveBeenCalledWith(endpoint, expect.objectContaining({ redirect: 'manual' }))
    await expect(restrictedFetch('http://127.0.0.1:47812/other')).rejects.toThrow('unexpected upstream')
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
})

describe('MCPB adapter authentication', () => {
  it('loads a valid owner token from the selected file without placing it in configuration', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'hronaut-mcpb-token-'))
    const tokenPath = join(directory, 'mcp-token')
    const token = 'a'.repeat(64)
    try {
      await writeFile(tokenPath, `${token}\n`, { mode: 0o600 })
      await expect(resolveAuthenticationToken({ HRONAUT_MCP_TOKEN_FILE: tokenPath })).resolves.toBe(token)
      await expect(resolveAuthenticationToken({})).resolves.toBeUndefined()
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('rejects invalid token files without exposing their path or contents', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'hronaut-private-path-'))
    const tokenPath = join(directory, 'mcp-token')
    const invalidToken = 'private token contents must not appear'
    try {
      await writeFile(tokenPath, invalidToken, { mode: 0o600 })
      const error = await resolveAuthenticationToken({ HRONAUT_MCP_TOKEN_FILE: tokenPath })
        .then(() => undefined, (reason: unknown) => reason)
      expect(error).toBeInstanceOf(Error)
      expect((error as Error).message).toBe('Hronaut MCP token file is invalid.')
      expect((error as Error).message).not.toContain(tokenPath)
      expect((error as Error).message).not.toContain(invalidToken)
      await expect(resolveAuthenticationToken({
        HRONAUT_MCP_TOKEN_FILE: join(directory, 'missing-token')
      })).rejects.toThrow('Hronaut MCP token file is invalid.')
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})

describe('MCPB adapter transport bridge', () => {
  it('forwards requests, responses, notifications, and cancellations without rewriting them', async () => {
    const downstream = new FakeTransport()
    const upstream = new FakeTransport()
    const close = await bridgeTransports(downstream, upstream)
    const messages = [
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25' } },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 7 } }
    ] as JSONRPCMessage[]
    for (const message of messages) downstream.onmessage?.(message)
    const response = { jsonrpc: '2.0', id: 1, result: { capabilities: {} } } as JSONRPCMessage
    upstream.onmessage?.(response)
    await vi.waitFor(() => {
      expect(upstream.sent).toEqual(messages)
      expect(downstream.sent).toEqual([response])
    })
    expect(upstream.protocolVersion).toBeUndefined()
    await close()
    expect(downstream.closed).toBe(true)
    expect(upstream.closed).toBe(true)
  })

  it('applies the negotiated protocol version to subsequent HTTP requests', async () => {
    const downstream = new FakeTransport()
    const upstream = new FakeTransport()
    await bridgeTransports(downstream, upstream)
    downstream.onmessage?.({
      jsonrpc: '2.0', id: 'init-1', method: 'initialize', params: { protocolVersion: '2025-11-25' }
    } as JSONRPCMessage)
    upstream.onmessage?.({
      jsonrpc: '2.0', id: 'init-1', result: { protocolVersion: '2025-11-25', capabilities: {} }
    } as JSONRPCMessage)
    await vi.waitFor(() => expect(upstream.protocolVersion).toBe('2025-11-25'))
  })

  it('does not hold cancellation behind a pending tool request', async () => {
    const downstream = new FakeTransport()
    const upstream = new FakeTransport()
    let finishRequest: (() => void) | undefined
    const pendingRequest = new Promise<void>((resolve) => { finishRequest = resolve })
    upstream.send = vi.fn(async (message: JSONRPCMessage) => {
      upstream.sent.push(message)
      if ('method' in message && message.method === 'tools/call') await pendingRequest
    })
    await bridgeTransports(downstream, upstream)
    downstream.onmessage?.({ jsonrpc: '2.0', id: 8, method: 'tools/call', params: {} } as JSONRPCMessage)
    downstream.onmessage?.({
      jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 8 }
    } as JSONRPCMessage)

    await vi.waitFor(() => expect(upstream.sent).toHaveLength(2))
    expect(upstream.sent[1]).toMatchObject({ method: 'notifications/cancelled' })
    finishRequest?.()
  })

  it('closes both sides when forwarding fails without exposing the message', async () => {
    const downstream = new FakeTransport()
    const upstream = new FakeTransport()
    const reportError = vi.fn()
    upstream.send = vi.fn().mockRejectedValue(new Error('Bearer secret from raw request'))
    await bridgeTransports(downstream, upstream, reportError)

    downstream.onmessage?.({ jsonrpc: '2.0', id: 2, method: 'tools/call' } as JSONRPCMessage)
    await vi.waitFor(() => expect(reportError).toHaveBeenCalledOnce())
    expect(downstream.closed).toBe(true)
    expect(upstream.closed).toBe(true)
  })
})
