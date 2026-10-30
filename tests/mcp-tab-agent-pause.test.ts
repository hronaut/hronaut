import { expect, it, vi } from 'vitest'
import { McpHttpServer } from '../src/main/mcp/server.js'
import { stageMcpRuntimeCandidate, synchronizeMcpRuntimeCandidate } from '../src/main/mcp-runtime/mcp-runtime-candidate.js'

// The fake browser below stubs the functions its tool calls go through; these reach its stubs.
// A fake browser that stubs no pause answers has no paused or taken-over tab.
vi.mock('../src/main/browser/agent-pause/agent-pause.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/main/browser/agent-pause/agent-pause.js')>(),
  hasAgentPauseExceptions: (browser: { hasAgentPauseExceptions: (...args: unknown[]) => unknown }, ...args: unknown[]) => browser.hasAgentPauseExceptions(...args),
  isTabAgentPaused: (browser: { isTabAgentPaused?: (...args: unknown[]) => unknown }, ...args: unknown[]) => browser.isTabAgentPaused?.(...args) ?? false,
  hasPausedAgentTab: (browser: { hasPausedAgentTab?: (...args: unknown[]) => unknown }, ...args: unknown[]) => browser.hasPausedAgentTab?.(...args) ?? false,
  isTabTakenOver: (browser: { isTabTakenOver?: (...args: unknown[]) => unknown }, ...args: unknown[]) => browser.isTabTakenOver?.(...args) ?? false
}))
vi.mock('../src/main/browser/mcp-tab-groups/mcp-tab-groups.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/main/browser/mcp-tab-groups/mcp-tab-groups.js')>(),
  listMcpTabGroups: (browser: { listMcpTabGroups: (...args: unknown[]) => unknown }, ...args: unknown[]) => browser.listMcpTabGroups(...args)
}))

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
    expect(manager.setTabAgentPaused).toHaveBeenCalledWith('tab', false, {})
    server.setTabAgentPaused('tab', true, { takeOver: true })
    expect(manager.setTabAgentPaused).toHaveBeenLastCalledWith('tab', true, { takeOver: true })
    server.setPaused(true, false)
    expect((await fetch(endpoint)).status).toBe(503)
    expect(() => server.setTabAgentPaused('tab', false)).toThrow(/protected operation/)
  } finally {
    await server.stop()
  }
})
