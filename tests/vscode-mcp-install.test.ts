import { describe, expect, it, vi } from 'vitest'
import {
  createVsCodeMcpInstallUri,
  openVsCodeMcpInstall
} from '../src/main/vscode-mcp-install.js'

function decodedInstallConfiguration(uri: string): unknown {
  const parsed = new URL(uri)
  expect(parsed.protocol).toBe('vscode:')
  expect(parsed.pathname).toBe('mcp/install')
  return JSON.parse(decodeURIComponent(parsed.search.slice(1))) as unknown
}

describe('VS Code MCP installation', () => {
  it('creates a credential-free install URI for the configured loopback endpoint', () => {
    const uri = createVsCodeMcpInstallUri('http://127.0.0.1:49152/mcp')

    expect(decodedInstallConfiguration(uri)).toEqual({
      name: 'hronaut',
      type: 'http',
      url: 'http://127.0.0.1:49152/mcp'
    })
    expect(uri).not.toMatch(/authorization|bearer|token|header/i)
  })

  it.each([
    'https://127.0.0.1:47812/mcp',
    'http://example.com:47812/mcp',
    'http://127.0.0.1:47812/other',
    'http://user:password@127.0.0.1:47812/mcp',
    'http://127.0.0.1:47812/mcp?token=secret',
    'http://127.0.0.1:47812/mcp#secret',
    'not a URL'
  ])('rejects an unsafe endpoint: %s', (endpoint) => {
    expect(() => createVsCodeMcpInstallUri(endpoint)).toThrow(/loopback MCP endpoint/i)
  })

  it('opens only the internally generated URI while authentication is disabled', async () => {
    const openExternal = vi.fn(async (_url: string) => undefined)

    await openVsCodeMcpInstall({
      endpoint: 'http://127.0.0.1:51234/mcp',
      authenticationEnabled: false,
      openExternal
    })

    expect(openExternal).toHaveBeenCalledTimes(1)
    expect(decodedInstallConfiguration(openExternal.mock.calls[0]![0])).toEqual({
      name: 'hronaut',
      type: 'http',
      url: 'http://127.0.0.1:51234/mcp'
    })
  })

  it('refuses to serialize credentials when authentication is enabled', async () => {
    const openExternal = vi.fn(async (_url: string) => undefined)

    await expect(openVsCodeMcpInstall({
      endpoint: 'http://127.0.0.1:47812/mcp',
      authenticationEnabled: true,
      openExternal
    })).rejects.toThrow(/authentication is enabled/i)
    expect(openExternal).not.toHaveBeenCalled()
  })
})
