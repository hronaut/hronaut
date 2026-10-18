import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { expect, it, vi } from 'vitest'
import { McpHttpServer } from '../src/main/mcp/server.js'
import { registerBrowserScreenshot } from '../src/main/mcp/tools/browser-screenshot/index.js'
import { screenshotSettlement } from '../src/main/mcp/tools/browser-screenshot/screenshot-settlement.js'
import type { WorkspaceToolCall } from '../src/main/mcp/tools/tool-context.js'

const workspaceId = '01912345-6789-7abc-8def-0123456789ab'
const tabId = '01912345-6790-7abc-8def-0123456789ab'

function fakeManager() {
  const workspace = { id: workspaceId, name: 'Screenshot QA', agentAccess: true, contextClass: 'standard' }
  return {
    suspendWorkspaceContinuity: vi.fn(() => false),
    requireWorkspaceContinuityDispatch: vi.fn(),
    beginWorkspaceContinuityAction: vi.fn(() => vi.fn()),
    createMcpTabGroup: vi.fn(async () => workspace),
    listWorkspaceForkSources: vi.fn(() => []),
    listMcpTabGroups: vi.fn(() => [workspace]),
    listSavedTabGroups: vi.fn(() => []),
    captureWorkspaceObservationGuard: vi.fn(() => vi.fn()),
    isWorkspaceAgentAccessible: vi.fn(() => true),
    isOpenAgentWorkspace: vi.fn(() => true),
    mcpWorkspaceResumeKey: vi.fn(() => `hrw1_${'R'.repeat(43)}`),
    requireMcpTabGroup: vi.fn(() => workspace),
    requireTabInMcpGroup: vi.fn(() => tabId),
    tabBelongsToMcpGroup: vi.fn(() => true),
    wakeTab: vi.fn(async () => undefined),
    cssStatePreviewMarker: vi.fn(() => undefined),
    // Every capture shows the same pixels in the same comparable state.
    trackedScreenshot: vi.fn(async () => ({ tabId, data: Buffer.from('synthetic pixels'), mimeType: 'image/png' as const, pixels: { digest: 'd'.repeat(64), width: 4, height: 2 }, comparable: 'same-state' })),
    screenshot: vi.fn(async () => ({ data: Buffer.from('synthetic pixels'), mimeType: 'image/png' as const })),
    getMcpGroupState: vi.fn(() => ({
      activeTabId: tabId,
      tabs: [{ id: tabId, url: 'https://example.test/', navigationGeneration: 1, observationGeneration: 1, humanInteractionGeneration: 0 }],
      mcpTabGroups: [workspace]
    }))
  }
}

function observation(result: CallToolResult): Record<string, unknown> {
  const block = result.content.find(item => item.type === 'text' && item.text.includes('"observation"'))
  if (!block || block.type !== 'text') throw new Error(`No observation in ${JSON.stringify(result)}`)
  return JSON.parse(block.text).observation
}

it('returns no image for unchanged pixels and refuses tracking of anything but a plain viewport through the real call wrapper', async () => {
  const manager = fakeManager()
  const server = new McpHttpServer(manager as never, {
    host: '127.0.0.1', port: 0, version: 'test', toolSet: 'essentials',
    showWindowInactive: () => undefined, getUserAttention: () => null, requestUserAttention: vi.fn(),
    bookmarks: {} as never, history: {} as never, siteData: {} as never
  })
  const first = new Client({ name: 'screenshot-session', version: '1' })
  try {
    const url = new URL(await server.start())
    await first.connect(new StreamableHTTPClientTransport(url))
    const resumed = await first.callTool({ name: 'browser_workspaces', arguments: { action: 'resume', workspaceId, resumeKey: `hrw1_${'R'.repeat(43)}` } }) as CallToolResult
    expect(resumed.isError, JSON.stringify(resumed)).not.toBe(true)
    const screenshot = (client: Client, args: Record<string, unknown>) =>
      client.callTool({ name: 'browser_screenshot', arguments: { workspaceId, tabId, ...args } }) as Promise<CallToolResult>

    const tracked = await screenshot(first, { trackChanges: true })
    expect(tracked.isError, JSON.stringify(tracked)).not.toBe(true)
    const id = observation(tracked).observationId as string
    expect(id).toMatch(/^[0-9a-f-]{36}$/)
    expect(tracked.content.filter(item => item.type === 'image')).toHaveLength(1)

    const same = await screenshot(first, { ifChangedSince: id })
    expect(observation(same)).toEqual({ status: 'UNCHANGED', observationId: id })
    expect(same.content.some(item => item.type === 'image')).toBe(false)
    expect(JSON.stringify(same)).not.toContain('d'.repeat(64))

    for (const args of [{ trackChanges: true, ref: 'e1' }, { trackChanges: true, annotateRefs: ['e1'] }, { ifChangedSince: id, fullPage: true }]) {
      const refused = await screenshot(first, args)
      expect(refused.isError, JSON.stringify(args)).toBe(true)
      expect(JSON.stringify(refused.content)).toContain('support plain viewport screenshots only')
    }
    // Only plain capture options reach the tracked capture.
    expect(manager.trackedScreenshot).toHaveBeenCalledWith({ tabId, format: undefined, quality: undefined, maxWidth: undefined, maxHeight: undefined })

  } finally {
    await first.close()
    await server.stop()
  }
})

it('keeps a tracked observation only when its result is published', () => {
  const requireWorkspace = vi.fn()
  const manager = { captureWorkspaceObservationGuard: vi.fn(() => requireWorkspace) }
  const settle = (call: Partial<WorkspaceToolCall<unknown>>) => {
    const settlement = screenshotSettlement(manager as never)
    const commit = vi.fn()
    settlement.prepare({ workspaceId, requireCurrentTarget: () => undefined, ...call } as WorkspaceToolCall<unknown>)
    settlement.retainObservation(commit)
    const result: CallToolResult = { content: [{ type: 'text', text: '{"observation":{}}' }] }
    return { published: settlement.publish(result) === result, commit }
  }
  expect(settle({})).toMatchObject({ published: true })
  expect(settle({}).commit).toHaveBeenCalledTimes(1)
  const abort = new AbortController()
  abort.abort()
  const cancelled = settle({ signal: abort.signal })
  expect(cancelled.published).toBe(false)
  expect(cancelled.commit).not.toHaveBeenCalled()
  const retargeted = settle({ requireCurrentTarget: () => { throw new Error('The tab changed') } })
  expect(retargeted.published).toBe(false)
  expect(retargeted.commit).not.toHaveBeenCalled()
  // A disposed call drops what it held.
  const settlement = screenshotSettlement(manager as never)
  const commit = vi.fn()
  settlement.prepare({ workspaceId, requireCurrentTarget: () => undefined } as unknown as WorkspaceToolCall<unknown>)
  settlement.retainObservation(commit)
  settlement.dispose()
  const result: CallToolResult = { content: [] }
  expect(settlement.publish(result)).toBe(result)
  expect(commit).not.toHaveBeenCalled()
})

it('gives each registration, which is each MCP session, its own observations', async () => {
  type Handler = (input: Record<string, unknown>, call: unknown) => Promise<CallToolResult>
  const manager = fakeManager()
  // Each MCP session builds its own server and registers its tools once, as http-server.ts does.
  const register = (): Handler => {
    let handler: Handler | undefined
    registerBrowserScreenshot({
      manager,
      tabTool: (_name: string, callback: Handler) => callback,
      registerWorkspaceTool: (_name: string, _config: unknown, callback: Handler) => { handler = callback }
    } as never)
    return handler!
  }
  const call = { workspaceId, tabId, settlement: { retainObservation: (commit: () => void) => commit() } }
  const first = register()
  const second = register()
  const id = observation(await first({ tabId, trackChanges: true }, call)).observationId
  expect(observation(await first({ tabId, ifChangedSince: id }, call))).toEqual({ status: 'UNCHANGED', observationId: id })
  // The same pixels in the same state and workspace: the id is unknown to the other session, and its image comes back.
  const foreign = await second({ tabId, ifChangedSince: id }, call)
  expect(observation(foreign)).toMatchObject({ status: 'NEW', baseline: 'unavailable', reason: 'unknown-or-expired' })
  expect(foreign.content.filter(item => item.type === 'image')).toHaveLength(1)
})
