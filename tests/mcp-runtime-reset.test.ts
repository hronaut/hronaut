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

interface RuntimeOptions {
  /** The address the running listener binds, which changes only with a restart. */
  listenerHost: string
  port: number
  /** Remote access as saved, which a person may have changed since the listener started. */
  savedRemoteAccess?: boolean
  /** This launch's authentication, when HRONAUT_DISABLE_MCP_AUTH overrides the saved value. */
  currentAuthentication?: boolean
}

/** A runtime with authentication saved on, whose saved and current settings update as settings-runtime's do. */
function runtime({ listenerHost, port, savedRemoteAccess = listenerHost === '0.0.0.0', currentAuthentication = true }: RuntimeOptions) {
  let persisted = { mcpRemoteAccess: savedRemoteAccess, mcpAuthentication: true, mcpPort: port } as AppSettings
  let current = { ...persisted, mcpAuthentication: currentAuthentication }
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
      tokenConfiguration: { token: TOKEN, tokenPath: '/profile/mcp-token', source: 'profile' as const }
    },
    createServer: vi.fn(() => candidate),
    mcpPauseState: { paused: false, temporarilyPaused: false },
    mcpPortRecovery: { failure: undefined, signal: vi.fn(), move: vi.fn(), record: vi.fn(), clear: vi.fn() },
    settings: () => current,
    persistedSettings: () => persisted,
    updateSettings: vi.fn(async (updates: Partial<AppSettings>) => {
      persisted = { ...persisted, ...updates }
      current = { ...current, ...updates }
      return current
    }),
    publishSettings: vi.fn(),
    publishMcpControlState: vi.fn(),
    refreshHomeAfterCommittedChange: vi.fn(),
    assertWorkspaceInitialized: vi.fn(),
    tabs: () => null,
    text: (key: string) => key,
    showMessageBox: vi.fn()
  }
  return { host, server, candidate, saved: () => persisted, reset: () => createMcpRuntime(host as never).resetMcpSettings() }
}

const PATHS = [
  ['on the default port', DEFAULT_MCP_PORT, 'server'],
  ['on another port, moving to the default one', 14555, 'candidate']
] as const

describe('resetting MCP settings', () => {
  // Turning remote access off takes a restart, but the reset turned authentication off at once, so until then anyone on
  // the network could use the browser without the token.
  it.each(PATHS)('keeps authentication while the listener still accepts other computers, %s', async (_name, port, listener) => {
    const test = runtime({ listenerHost: '0.0.0.0', port })

    const settings = await test.reset()

    expect(settings).toMatchObject({ mcpRemoteAccess: false, mcpAuthentication: true, mcpPort: DEFAULT_MCP_PORT, mcpToolSet: DEFAULT_MCP_TOOL_SET })
    expect(test.saved()).toMatchObject({ mcpRemoteAccess: false, mcpAuthentication: true })
    expect(test[listener].setAuthenticationToken).toHaveBeenLastCalledWith(TOKEN)
    expect(test[listener].setAuthenticationToken).not.toHaveBeenCalledWith(undefined)
  })

  it.each(PATHS)('goes by the running listener, not remote access as saved since it started, %s', async (_name, port, listener) => {
    // Remote access turned off without a restart: the listener still accepts other computers.
    const stillOpen = runtime({ listenerHost: '0.0.0.0', port, savedRemoteAccess: false })
    expect(await stillOpen.reset()).toMatchObject({ mcpAuthentication: true })
    expect(stillOpen[listener].setAuthenticationToken).toHaveBeenLastCalledWith(TOKEN)
    // Remote access turned on without a restart: the listener is still on this computer alone.
    const stillLocal = runtime({ listenerHost: '127.0.0.1', port, savedRemoteAccess: true })
    expect(await stillLocal.reset()).toMatchObject({ mcpRemoteAccess: false, mcpAuthentication: false })
    expect(stillLocal[listener].setAuthenticationToken).toHaveBeenLastCalledWith(undefined)
  })

  it.each(PATHS)('turns authentication off for a listener on this computer only, %s', async (_name, port, listener) => {
    const test = runtime({ listenerHost: '127.0.0.1', port })

    const settings = await test.reset()

    expect(settings).toMatchObject({ mcpRemoteAccess: false, mcpAuthentication: false, mcpPort: DEFAULT_MCP_PORT })
    expect(test.saved()).toMatchObject({ mcpAuthentication: false })
    expect(test[listener].setAuthenticationToken).toHaveBeenLastCalledWith(undefined)
  })

  it('keeps authentication saved on when this launch turned it off with HRONAUT_DISABLE_MCP_AUTH', async () => {
    const test = runtime({ listenerHost: '0.0.0.0', port: DEFAULT_MCP_PORT, currentAuthentication: false })

    await test.reset()

    expect(test.saved()).toMatchObject({ mcpAuthentication: true })
    expect(test.host.settings()).toMatchObject({ mcpAuthentication: false })
  })
})
