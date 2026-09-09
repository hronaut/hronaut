import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { afterEach, expect, it, vi } from 'vitest'
import { McpHttpServer } from '../src/main/mcp/server.js'
import { HumanWaitingService } from '../src/main/mcp/human-waiting-service.js'

const workspaceId = '01912345-6789-7abc-8def-0123456789ab'
const otherWorkspaceId = '01912345-678b-7abc-8def-0123456789ab'
const resumeKey = `hrw1_${'A'.repeat(43)}`
let client: Client | undefined
let server: McpHttpServer | undefined
afterEach(async () => { await client?.close(); await server?.stop() })
const text = (result: CallToolResult) => result.content.filter(item => item.type === 'text').map(item => item.text).join('\n')

it('exposes tabless waiting only to its owner and blocks dispatch without allowing agent acknowledgment', async () => {
  const manager = {
    transferWorkspaceStorage: vi.fn(async () => ({})),
    createMcpTabGroup: vi.fn(async () => ({ id: otherWorkspaceId })),
    suspendWorkspaceContinuity: vi.fn(), requireWorkspaceContinuityDispatch: vi.fn(),
    requireWorkspaceContinuityReview: vi.fn(async () => true),
    beginWorkspaceContinuityAction: vi.fn(() => vi.fn()),
    requireMcpTabGroup: vi.fn(() => ({ id: workspaceId, isDefault: false })),
    requireTabInMcpGroup: vi.fn(() => { throw new Error('No tab') }),
    isWorkspaceAgentAccessible: vi.fn(() => true),
    listMcpTabGroups: vi.fn(() => [{ id: workspaceId, isDefault: false }]),
    listSavedTabGroups: vi.fn(() => []), mcpWorkspaceResumeKey: vi.fn(() => resumeKey),
    getMcpGroupState: vi.fn(() => ({ activeTabId: null, tabs: [], closedTabs: [], mcpTabGroups: [], savedTabGroups: [] })),
    getState: vi.fn(() => ({ activeTabId: null, tabs: [] }))
  }
  const waiting = new HumanWaitingService({ load: async () => null, save: async () => undefined })
  server = new McpHttpServer(manager as never, {
    host: '127.0.0.1', port: 0, version: 'test', toolSet: 'complete', humanWaiting: waiting,
    showWindowInactive: vi.fn(), getUserAttention: () => null, requestUserAttention: vi.fn(),
    bookmarks: {} as never, history: {} as never, siteData: {} as never
  })
  client = new Client({ name: 'waiting-test', version: '1' })
  await client.connect(new StreamableHTTPClientTransport(new URL(await server.start())))
  const call = async (name: string, arguments_: Record<string, unknown>) => await client!.callTool({ name, arguments: arguments_ }) as CallToolResult
  expect((await call('browser_human_waiting', { workspaceId })).isError).toBe(true)
  const resumed = await call('browser_workspaces', { action: 'resume', workspaceId, resumeKey })
  expect(resumed.isError, text(resumed)).not.toBe(true)
  const request = await call('browser_human_waiting', { workspaceId, action: 'request', runId: otherWorkspaceId, decision: 'review-page' })
  expect(request.isError, text(request)).not.toBe(true)
  const record = JSON.parse(text(request)) as { id: string; revision: string }
  const listed = await call('browser_human_waiting', { workspaceId })
  expect(JSON.parse(text(listed))).toMatchObject([{ id: record.id, state: 'WAITING_FOR_HUMAN', priorOutcome: 'OUTCOME_UNKNOWN' }])
  expect((await call('browser_human_waiting', { workspaceId: otherWorkspaceId })).isError).toBe(true)
  const blocked = await call('browser_click', { workspaceId, selector: '#submit' })
  expect(blocked.isError).toBe(true)
  expect(text(blocked)).toContain('waiting for a human')
  expect(manager.requireTabInMcpGroup).not.toHaveBeenCalled()
  for (const args of [
    { action: 'import-default', workspaceId },
    { action: 'create', name: 'Fork pending decision', storage: 'fork-workspace', sourceWorkspaceId: workspaceId }
  ]) {
    const storageBlocked = await call('browser_workspaces', args)
    expect(storageBlocked.isError).toBe(true)
    expect(text(storageBlocked)).toContain('waiting for a human')
  }
  expect(manager.transferWorkspaceStorage).not.toHaveBeenCalled()
  expect(manager.createMcpTabGroup).not.toHaveBeenCalled()
  expect((await call('browser_human_waiting', { workspaceId, action: 'acknowledge', ...record })).isError).toBe(true)
  expect((await call('browser_human_waiting', { workspaceId, action: 'resolve', ...record })).isError).toBe(true)
  const cancelled = await call('browser_human_waiting', { workspaceId, action: 'cancel', ...record })
  expect(cancelled.isError, text(cancelled)).not.toBe(true)
  expect(JSON.parse(text(cancelled))).toMatchObject({ state: 'CANCELLED', priorOutcome: 'OUTCOME_UNKNOWN' })
  expect(manager.requireWorkspaceContinuityReview).toHaveBeenCalledWith(workspaceId)
  manager.transferWorkspaceStorage.mockImplementationOnce(async () => {
    await waiting.create({ workspaceId, runId: otherWorkspaceId, decision: 'review-page', owner: 'operator', fallbackOwner: 'operator', timeoutMs: 60_000, priorOutcome: 'OUTCOME_UNKNOWN' }, () => undefined)
    return {}
  })
  const interrupted = await call('browser_workspaces', { action: 'import-default', workspaceId })
  expect(interrupted.isError).toBe(true)
  expect(JSON.parse(text(interrupted))).toMatchObject({ status: 'OUTCOME_UNKNOWN', effects: 'possible' })
  expect(manager.transferWorkspaceStorage).toHaveBeenCalledTimes(1)
  expect(manager.suspendWorkspaceContinuity).toHaveBeenCalledWith(workspaceId, 'OUTCOME_UNKNOWN')
  const pending = (await waiting.list(workspaceId, () => undefined)).find(item => item.state === 'WAITING_FOR_HUMAN')!
  await waiting.change(workspaceId, pending.id, pending.revision, 'cancel', () => undefined)
  manager.createMcpTabGroup.mockImplementationOnce(async () => {
    await waiting.create({ workspaceId, runId: otherWorkspaceId, decision: 'review-page', owner: 'operator', fallbackOwner: 'operator', timeoutMs: 60_000, priorOutcome: 'OUTCOME_UNKNOWN' }, () => undefined)
    return { id: otherWorkspaceId }
  })
  const interruptedFork = await call('browser_workspaces', { action: 'create', name: 'Interrupted fork', storage: 'fork-workspace', sourceWorkspaceId: workspaceId })
  expect(interruptedFork.isError).toBe(true)
  expect(JSON.parse(text(interruptedFork))).toMatchObject({ status: 'OUTCOME_UNKNOWN', effects: 'possible', retained: true, workspaceId: otherWorkspaceId })
  expect(manager.createMcpTabGroup).toHaveBeenCalledTimes(1)
  expect(manager.requireWorkspaceContinuityReview).toHaveBeenCalledWith(otherWorkspaceId)
})
