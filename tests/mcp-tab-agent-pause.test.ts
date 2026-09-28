import { expect, it, vi } from 'vitest'
import { McpHttpServer } from '../src/main/mcp/server.js'
import { stageMcpRuntimeCandidate, synchronizeMcpRuntimeCandidate } from '../src/main/mcp-runtime-candidate.js'

it('never lets existing tab exceptions bypass a staged listener or protected pause', async () => {
  const manager = {
    hasAgentPauseExceptions: () => true,
    listMcpTabGroups: () => [],
    setTabAgentPaused: vi.fn(() => ({ tabs: [] }))
  }
  const server = new McpHttpServer(manager as never, {
    host: '127.0.0.1', port: 0, version: 'test',
    showWindowInactive: () => undefined, getUserAttention: () => null,
    requestUserAttention: vi.fn(), bookmarks: {} as never, history: {} as never, siteData: {} as never
  })
  stageMcpRuntimeCandidate(server)
  try {
    const endpoint = await server.start()
    expect((await fetch(endpoint)).status).toBe(503)
    expect(() => server.setTabAgentPaused('tab', false)).toThrow(/protected operation/)
    expect(manager.setTabAgentPaused).not.toHaveBeenCalled()
    synchronizeMcpRuntimeCandidate(server, () => ({ paused: true, allowTabPauseOverrides: true, authenticationToken: undefined }))
    // The staging gate is gone; an uninitialized transport still cannot run tools.
    expect((await fetch(endpoint)).status).not.toBe(503)
    server.setTabAgentPaused('tab', false)
    expect(manager.setTabAgentPaused).toHaveBeenCalledWith('tab', false)
    server.setPaused(true, false)
    expect((await fetch(endpoint)).status).toBe(503)
    expect(() => server.setTabAgentPaused('tab', false)).toThrow(/protected operation/)
  } finally {
    await server.stop()
  }
})
