import { describe, expect, it, vi } from 'vitest'
import { createMcpRuntime } from '../src/main/mcp-runtime.js'
import { DEFAULT_MCP_PORT } from '../src/shared/mcp-port.js'
import { DEFAULT_MCP_TOOL_SET } from '../src/shared/mcp-tool-sets.js'
import type { AppSettings } from '../src/shared/types.js'

const TOKEN = 'reset-test-token'

function fakeServer() {
  return {
    start: vi.fn(async () => undefined),
    stop: vi.fn(async () => undefined),
    setPaused: vi.fn(),
    setAuthenticationToken: vi.fn(),
    setToolSet: vi.fn()
  }
}

/** A runtime whose listener binds `listenerHost` on `port` with authentication on, as saved settings say. */
function runtime(listenerHost: string, port: number) {
  let settings = { mcpRemoteAccess: listenerHost === '0.0.0.0', mcpAuthentication: true, mcpPort: port } as AppSettings
  const server = fakeServer()
  const candidate = fakeServer()
  const host = {
    state: {
      host: listenerHost,
      server,
      port,
      url: `http://127.0.0.1:${port}/mcp`,
      status: 'ready' as const,
      startupError: undefined,
      tokenConfiguration: { token: TOKEN, path: '/profile/mcp-token' }
    },
    createServer: vi.fn(() => candidate),
    mcpPauseState: { paused: false, temporarilyPaused: false },
    mcpPortRecovery: { failure: undefined, signal: vi.fn(), move: vi.fn(), record: vi.fn(), clear: vi.fn() },
    settings: () => settings,
    persistedSettings: () => settings,
    updateSettings: vi.fn(async (updates: Partial<AppSettings>) => {
      settings = { ...settings, ...updates }
      return settings
    }),
    publishSettings: vi.fn(),
    publishMcpControlState: vi.fn(),
    refreshHomeAfterCommittedChange: vi.fn(),
    assertWorkspaceInitialized: vi.fn(),
    tabs: () => null,
    text: (key: string) => key,
    showMessageBox: vi.fn()
  }
  return { host, server, candidate, reset: () => createMcpRuntime(host as never).resetMcpSettings() }
}

describe('resetting MCP settings', () => {
  // Turning remote access off takes a restart, but the reset turned authentication off at once, so until then anyone on
  // the network could use the browser without the token.
  it.each([
    ['on the default port', DEFAULT_MCP_PORT, 'server'],
    ['on another port, moving to the default one', 14555, 'candidate']
  ] as const)('keeps authentication while the listener still accepts other computers, %s', async (_name, port, listener) => {
    const test = runtime('0.0.0.0', port)

    const settings = await test.reset()

    expect(settings).toMatchObject({ mcpRemoteAccess: false, mcpAuthentication: true, mcpPort: DEFAULT_MCP_PORT, mcpToolSet: DEFAULT_MCP_TOOL_SET })
    expect(test.host.updateSettings).toHaveBeenCalledWith(expect.objectContaining({ mcpRemoteAccess: false, mcpAuthentication: true }))
    expect(test[listener].setAuthenticationToken).toHaveBeenLastCalledWith(TOKEN)
    expect(test[listener].setAuthenticationToken).not.toHaveBeenCalledWith(undefined)
  })

  it.each([
    ['on the default port', DEFAULT_MCP_PORT, 'server'],
    ['on another port, moving to the default one', 14555, 'candidate']
  ] as const)('turns authentication off for a listener on this computer only, %s', async (_name, port, listener) => {
    const test = runtime('127.0.0.1', port)

    const settings = await test.reset()

    expect(settings).toMatchObject({ mcpRemoteAccess: false, mcpAuthentication: false, mcpPort: DEFAULT_MCP_PORT })
    expect(test[listener].setAuthenticationToken).toHaveBeenLastCalledWith(undefined)
  })
})
