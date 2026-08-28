import { afterEach, describe, expect, it } from 'vitest'
import { assertMcpToolRegistrationContract, McpHttpServer, mcpRequestAuthorized } from '../src/main/mcp/server.js'

const TOKEN = 'abcdefghijklmnopqrstuvwxyz_ABCDEFG-1234567890'

describe('MCP HTTP authentication', () => {
  it('requires the configured bearer token', () => {
    expect(mcpRequestAuthorized(TOKEN, undefined)).toBe(false)
    expect(mcpRequestAuthorized(TOKEN, 'Bearer wrong')).toBe(false)
    expect(mcpRequestAuthorized(TOKEN, `Bearer ${TOKEN}`)).toBe(true)
    expect(mcpRequestAuthorized(TOKEN, `bearer ${TOKEN}`)).toBe(true)
    expect(mcpRequestAuthorized(TOKEN, `BEARER  ${TOKEN}`)).toBe(true)
    expect(mcpRequestAuthorized(TOKEN, `bearer ${TOKEN}extra`)).toBe(false)
    expect(mcpRequestAuthorized(TOKEN, `Bearer\t${TOKEN}`)).toBe(false)
  })

  it('allows requests when authentication is explicitly disabled', () => {
    expect(mcpRequestAuthorized(undefined, undefined)).toBe(true)
  })
})

describe('MCP HTTP authentication middleware order', () => {
  let server: McpHttpServer | undefined

  afterEach(async () => {
    await server?.stop()
    server = undefined
  })

  it.each([
    ['malformed', '{not json'],
    ['oversized', JSON.stringify({ value: 'x'.repeat(2 * 1024 * 1024) })]
  ])('rejects an unauthorized %s body before parsing it', async (_kind, body) => {
    server = new McpHttpServer({} as never, {
      host: '127.0.0.1',
      port: 0,
      version: 'test',
      token: TOKEN,
      showWindow: () => undefined,
      getUserAttention: () => null,
      requestUserAttention: async (request) => ({ ...request, id: 'request', requestedAt: new Date().toISOString() }),
      bookmarks: {} as never,
      history: {} as never,
      siteData: {} as never
    })
    const endpoint = await server.start()

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body
    })

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
  })
})

describe('MCP tool registration contract', () => {
  it('accepts one registration for every catalog entry', () => {
    expect(() => assertMcpToolRegistrationContract(
      [{ name: 'browser_status' }, { name: 'browser_tabs' }],
      ['browser_status', 'browser_tabs']
    )).not.toThrow()
  })

  it('reports duplicate, missing, and unadvertised registrations together', () => {
    expect(() => assertMcpToolRegistrationContract(
      [{ name: 'browser_status' }, { name: 'browser_tabs' }, { name: 'browser_tabs' }],
      ['browser_status', 'browser_status', 'browser_unknown']
    )).toThrow(
      'duplicate catalog tools: browser_tabs; duplicate registrations: browser_status; missing registration: browser_tabs; unadvertised registration: browser_unknown'
    )
  })
})
