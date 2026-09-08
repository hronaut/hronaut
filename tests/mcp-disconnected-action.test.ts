import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { expect, it, vi } from 'vitest'
import { McpHttpServer } from '../src/main/mcp/server.js'
import { fillCredentialWhileMcpPaused } from '../src/main/credential-fill-pause.js'
import { McpActionTracker } from '../src/main/mcp/action-tracker.js'

it.each([
  { replaceEndpoint: false, rejectAction: false },
  { replaceEndpoint: true, rejectAction: false },
  { replaceEndpoint: false, rejectAction: true },
  { replaceEndpoint: true, rejectAction: true }
])('keeps credential filling blocked until a disconnected command settles ($replaceEndpoint, $rejectAction)', async ({ replaceEndpoint, rejectAction }) => {
  const workspaceId = '01912345-6789-7abc-8def-0123456789ab'
  const tabId = '01912345-678a-7abc-8def-0123456789ab'
  const resumeKey = `hrw1_${'A'.repeat(43)}`
  let settle!: () => void
  const pending = new Promise<void>(resolve => { settle = resolve })
  let entered!: () => void
  const started = new Promise<void>(resolve => { entered = resolve })
  let operationFinished = false
  const manager = {
    requireMcpTabGroup: () => ({ id: workspaceId, isDefault: false }),
    requireTabInMcpGroup: () => tabId,
    tabBelongsToMcpGroup: (groupId: string, id: string) => groupId === workspaceId && id === tabId,
    wakeTab: async () => undefined,
    isWorkspaceAgentAccessible: () => true,
    listMcpTabGroups: () => [{ id: workspaceId, isDefault: false }],
    listSavedTabGroups: () => [],
    mcpWorkspaceResumeKey: () => resumeKey,
    selectTabAndWait: async () => {
      entered()
      await pending
      operationFinished = true
      if (rejectAction) throw new Error('Synthetic delayed selection failure')
    },
    getMcpGroupState: () => ({ activeTabId: tabId, tabs: [{ id: tabId }] })
  }
  const actionTracker = new McpActionTracker()
  const makeServer = () => new McpHttpServer(manager as never, {
    actionTracker,
    host: '127.0.0.1', port: 0, version: 'test',
    showWindowInactive: () => undefined, getUserAttention: () => null,
    requestUserAttention: vi.fn(), bookmarks: {} as never, history: {} as never, siteData: {} as never
  })
  const server = makeServer()
  let replacement: McpHttpServer | undefined
  const client = new Client({ name: 'disconnected-command-test', version: '1' })
  let command: Promise<unknown> | undefined
  try {
    let endpoint = await server.start()
    await client.connect(new StreamableHTTPClientTransport(new URL(endpoint)))
    await client.callTool({ name: 'browser_workspaces', arguments: { action: 'resume', workspaceId, resumeKey } })
    command = client.callTool({ name: 'browser_show', arguments: { workspaceId } }).catch(() => undefined)
    await started
    await client.close()
    await expect.poll(() => server.getDashboardState().activeRequests).toBe(0)
    expect(operationFinished).toBe(false)
    if (replaceEndpoint) {
      await server.stop()
      replacement = makeServer()
      endpoint = await replacement.start()
    }
    const currentServer = replacement ?? server
    const fill = vi.fn(async () => true)
    const options = {
      pausePersistently: () => currentServer.setPaused(true),
      acquireTemporaryPause: () => () => undefined,
      getActiveRequestCount: () => currentServer.getActiveRequestCount(),
      fill, timeoutMs: 0
    }
    await expect(fillCredentialWhileMcpPaused(options)).rejects.toThrow('MCP command was still active')
    expect(fill).not.toHaveBeenCalled()
    const paused = await fetch(endpoint)
    expect(paused.status).toBe(503)
    expect(await paused.json()).toMatchObject({ handoff: {
      state: 'PAUSED_WITH_ACTIVE_COMMANDS', activeCommands: 1, priorActionOutcome: 'NOT_ESTABLISHED'
    } })
    settle()
    await expect.poll(() => actionTracker.activeCount).toBe(0)
    expect(await (await fetch(endpoint)).json()).toMatchObject({ handoff: {
      state: 'PAUSED', activeCommands: 0, priorActionOutcome: 'NOT_ESTABLISHED'
    } })
    await expect(fillCredentialWhileMcpPaused(options)).resolves.toBe(true)
  } finally {
    settle()
    await command
    await client.close()
    await server.stop()
    await replacement?.stop()
  }
})
