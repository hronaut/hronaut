import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { closeFixtureServer, closeHronaut, expect, launchHronaut, test } from './fixtures.js'

const text = (result: CallToolResult): string => result.content
  .filter(part => part.type === 'text').map(part => part.text).join('\n')

test('keeps browser task completion bounded, checked, private, and connection-scoped', async ({ mcpPort, mcpToken }) => {
  const firstSite = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end('<!doctype html><title>Task run private page</title><main>private completion canary</main>')
  })
  const secondSite = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end('<!doctype html><title>Changed origin</title>')
  })
  await Promise.all([
    new Promise<void>(resolve => firstSite.listen(0, '127.0.0.1', resolve)),
    new Promise<void>(resolve => secondSite.listen(0, '127.0.0.1', resolve))
  ])
  const firstAddress = firstSite.address()
  const secondAddress = secondSite.address()
  if (!firstAddress || typeof firstAddress === 'string' || !secondAddress || typeof secondAddress === 'string') {
    throw new Error('Fixture address unavailable')
  }
  const origin = `http://127.0.0.1:${firstAddress.port}`
  const changedOrigin = `http://127.0.0.1:${secondAddress.port}`
  const clients: Client[] = []
  const connect = async (name: string): Promise<Client> => {
    const client = new Client({ name, version: '1' })
    clients.push(client)
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort}/mcp`), {
      requestInit: { headers: { authorization: `Bearer ${mcpToken}` } }
    }))
    return client
  }
  const raw = async (client: Client, name: string, args: Record<string, unknown>): Promise<CallToolResult> => (
    await client.callTool({ name, arguments: args }) as CallToolResult
  )
  const call = async <T>(client: Client, name: string, args: Record<string, unknown>): Promise<T> => {
    const result = await raw(client, name, args)
    expect(result.isError, text(result)).not.toBe(true)
    return JSON.parse(text(result)) as T
  }

  try {
    await expect.poll(async () => {
      try { return (await fetch(`http://127.0.0.1:${mcpPort}/healthz`)).ok } catch { return false }
    }).toBe(true)
    const owner = await connect('task-run-owner')
    const workspace = await call<{ id: string; resumeKey: string }>(owner, 'browser_workspaces', {
      action: 'create', name: 'Bounded task run', storage: 'scratch'
    })
    const opened = await call<{ activeTabId: string }>(owner, 'browser_new_tab', {
      workspaceId: workspace.id, url: `${origin}/private-path?token=private-token`
    })
    await expect.poll(async () => {
      const status = await call<{ tabs: Array<{ id: string; loading: boolean }> }>(owner, 'browser_status', {
        workspaceId: workspace.id
      })
      return status.tabs.find(tab => tab.id === opened.activeTabId)?.loading
    }).toBe(false)
    const run = await call<{ id: string; revision: string }>(owner, 'browser_task_runs', {
      workspaceId: workspace.id,
      action: 'start',
      deadlineMs: 60_000,
      heartbeatTimeoutMs: 10_000,
      checks: [
        { id: 'page', type: 'page-settled', tabId: opened.activeTabId },
        { id: 'origin', type: 'expected-origin', tabId: opened.activeTabId, expectedOrigin: origin }
      ]
    })
    const heartbeat = await call<{ revision: string }>(owner, 'browser_task_runs', {
      workspaceId: workspace.id, action: 'heartbeat', taskRunId: run.id, revision: run.revision
    })
    expect((await raw(owner, 'browser_task_runs', {
      workspaceId: workspace.id, action: 'heartbeat', taskRunId: run.id, revision: run.revision
    })).isError).toBe(true)

    const stranger = await connect('task-run-stranger')
    expect((await raw(stranger, 'browser_task_runs', {
      workspaceId: workspace.id, action: 'get', taskRunId: run.id
    })).isError).toBe(true)

    const succeeded = await call<{ state: string; terminalReason: string | null; checks: unknown[] }>(owner, 'browser_task_runs', {
      workspaceId: workspace.id,
      action: 'complete',
      taskRunId: run.id,
      revision: heartbeat.revision,
      outcome: 'SUCCEEDED'
    })
    expect(succeeded).toMatchObject({
      state: 'SUCCEEDED', terminalReason: null,
      checks: [
        { id: 'page', type: 'page-settled', status: 'PASS', tabId: opened.activeTabId },
        { id: 'origin', type: 'expected-origin', status: 'PASS', tabId: opened.activeTabId }
      ]
    })
    const exported = JSON.stringify(succeeded)
    for (const privateValue of [origin, 'private-path', 'private-token', 'private completion canary', mcpToken]) {
      expect(exported).not.toContain(privateValue)
    }

    const audit = await call<{ id: string }>(owner, 'browser_audit_receipts', {
      workspaceId: workspace.id, action: 'start'
    })
    const snapshot = await raw(owner, 'browser_snapshot', { workspaceId: workspace.id, tabId: opened.activeTabId })
    expect(snapshot.isError, text(snapshot)).not.toBe(true)
    await call(owner, 'browser_audit_receipts', { workspaceId: workspace.id, action: 'stop' })
    const artifactRun = await call<{ id: string; revision: string }>(owner, 'browser_task_runs', {
      workspaceId: workspace.id,
      action: 'start',
      checks: [{ id: 'audit', type: 'audit-run', runId: audit.id }]
    })
    expect(await call(owner, 'browser_task_runs', {
      workspaceId: workspace.id,
      action: 'complete',
      taskRunId: artifactRun.id,
      revision: artifactRun.revision,
      outcome: 'SUCCEEDED'
    })).toMatchObject({
      state: 'SUCCEEDED',
      checks: [{ id: 'audit', type: 'audit-run', artifactId: audit.id, status: 'PASS' }]
    })

    const changed = await call<{ id: string; revision: string }>(owner, 'browser_task_runs', {
      workspaceId: workspace.id,
      action: 'start',
      checks: [{ id: 'origin', type: 'expected-origin', tabId: opened.activeTabId, expectedOrigin: origin }]
    })
    await call(owner, 'browser_navigate', { workspaceId: workspace.id, tabId: opened.activeTabId, url: changedOrigin })
    const blocked = await call<{ state: string; terminalReason: string }>(owner, 'browser_task_runs', {
      workspaceId: workspace.id,
      action: 'complete',
      taskRunId: changed.id,
      revision: changed.revision,
      outcome: 'SUCCEEDED'
    })
    expect(blocked).toMatchObject({ state: 'BLOCKED', terminalReason: 'COMPLETION_CHECK_FAILED' })

    const unchecked = await call<{ id: string; revision: string }>(owner, 'browser_task_runs', {
      workspaceId: workspace.id, action: 'start'
    })
    const uncheckedSuccess = await raw(owner, 'browser_task_runs', {
      workspaceId: workspace.id, action: 'complete', taskRunId: unchecked.id,
      revision: unchecked.revision, outcome: 'SUCCEEDED'
    })
    expect(uncheckedSuccess.isError).toBe(true)
    expect(text(uncheckedSuccess)).toContain('machine-checkable completion check')
    expect(await call(owner, 'browser_task_runs', {
      workspaceId: workspace.id, action: 'complete', taskRunId: unchecked.id,
      revision: unchecked.revision, outcome: 'OUTCOME_UNKNOWN'
    })).toMatchObject({
      state: 'OUTCOME_UNKNOWN', terminalReason: 'CALLER_REPORTED_UNKNOWN', outcome: 'outcome-unknown',
      reasonCode: 'CALLER_REPORTED_UNKNOWN', evidenceSource: 'caller-supplied', effects: 'not-established'
    })

    const cancellable = await call<{ id: string; revision: string }>(owner, 'browser_task_runs', {
      workspaceId: workspace.id, action: 'start'
    })
    expect(await call(owner, 'browser_task_runs', {
      workspaceId: workspace.id, action: 'complete', taskRunId: cancellable.id,
      revision: cancellable.revision, outcome: 'CANCELLED'
    })).toMatchObject({
      state: 'CANCELLED', terminalReason: 'CALLER_REPORTED_CANCELLED', outcome: 'cancelled',
      reasonCode: 'CALLER_REPORTED_CANCELLED', evidenceSource: 'caller-supplied', effects: 'not-established'
    })
  } finally {
    await Promise.allSettled(clients.map(client => client.close()))
    await Promise.all([closeFixtureServer(firstSite), closeFixtureServer(secondSite)])
  }
})

test('restores unfinished task runs as unknown and durably records heartbeat expiry', async ({ profileDirectory, mcpPort }) => {
  let instance = await launchHronaut(profileDirectory, mcpPort)
  const token = (await readFile(join(profileDirectory, 'mcp-token'), 'utf8')).trim()
  const clients: Client[] = []
  const connect = async (name: string): Promise<Client> => {
    await expect.poll(async () => {
      try { return (await fetch(`http://127.0.0.1:${mcpPort}/healthz`)).ok } catch { return false }
    }).toBe(true)
    const client = new Client({ name, version: '1' })
    clients.push(client)
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort}/mcp`), {
      requestInit: { headers: { authorization: `Bearer ${token}` } }
    }))
    return client
  }
  const call = async <T>(client: Client, name: string, args: Record<string, unknown>): Promise<T> => {
    const result = await client.callTool({ name, arguments: args }) as CallToolResult
    expect(result.isError, text(result)).not.toBe(true)
    return JSON.parse(text(result)) as T
  }

  try {
    const first = await connect('task-run-restart-before')
    const workspace = await call<{ id: string; resumeKey: string }>(first, 'browser_workspaces', {
      action: 'create', name: 'Persistent task run', storage: 'scratch'
    })
    const active = await call<{ id: string; revision: string }>(first, 'browser_task_runs', {
      workspaceId: workspace.id, action: 'start', deadlineMs: 60_000, heartbeatTimeoutMs: 10_000
    })
    await first.close()
    await closeHronaut(instance.app)
    instance = await launchHronaut(profileDirectory, mcpPort)

    const second = await connect('task-run-restart-after')
    await call(second, 'browser_workspaces', {
      action: 'resume', workspaceId: workspace.id, resumeKey: workspace.resumeKey
    })
    expect(await call(second, 'browser_task_runs', {
      workspaceId: workspace.id, action: 'get', taskRunId: active.id
    })).toMatchObject({ state: 'OUTCOME_UNKNOWN', terminalReason: 'RESTART' })

    const expiring = await call<{ id: string }>(second, 'browser_task_runs', {
      workspaceId: workspace.id, action: 'start', deadlineMs: 60_000, heartbeatTimeoutMs: 1_000
    })
    await expect.poll(async () => (await call<Array<{ id: string; state: string }>>(second, 'browser_task_runs', {
      workspaceId: workspace.id, action: 'list'
    })).find(run => run.id === expiring.id)?.state).toBe('TIMED_OUT')
    const saved = JSON.parse(await readFile(join(profileDirectory, 'task-runs.json'), 'utf8')) as {
      records: Array<{ id: string; state: string; terminalReason: string }>
    }
    expect(saved.records.find(run => run.id === expiring.id)).toMatchObject({
      state: 'TIMED_OUT', terminalReason: 'HEARTBEAT_EXPIRED'
    })
  } finally {
    await Promise.allSettled(clients.map(client => client.close()))
    await closeHronaut(instance.app)
  }
})
