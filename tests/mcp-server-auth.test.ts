import { describe, expect, it } from 'vitest'
import { assertMcpToolRegistrationContract, mcpRequestAuthorized } from '../src/main/mcp/server.js'

describe('MCP HTTP authentication', () => {
  it('requires the configured bearer token', () => {
    const token = 'abcdefghijklmnopqrstuvwxyz_ABCDEFG-1234567890'
    expect(mcpRequestAuthorized(token, undefined)).toBe(false)
    expect(mcpRequestAuthorized(token, 'Bearer wrong')).toBe(false)
    expect(mcpRequestAuthorized(token, `Bearer ${token}`)).toBe(true)
    expect(mcpRequestAuthorized(token, `bearer ${token}`)).toBe(true)
    expect(mcpRequestAuthorized(token, `BEARER  ${token}`)).toBe(true)
    expect(mcpRequestAuthorized(token, `bearer ${token}extra`)).toBe(false)
    expect(mcpRequestAuthorized(token, `Bearer\t${token}`)).toBe(false)
  })

  it('allows requests when authentication is explicitly disabled', () => {
    expect(mcpRequestAuthorized(undefined, undefined)).toBe(true)
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
