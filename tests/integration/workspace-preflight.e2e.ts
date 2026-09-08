import { createServer } from 'node:http'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { BrowserState } from '../../src/shared/types.js'
import type { workspacePreflight } from '../../src/main/mcp/workspace-preflight.js'
import { closeFixtureServer, expect, test } from './fixtures.js'

type Report = ReturnType<typeof workspacePreflight>
test('checks authorized workspace readiness without exposing private context or waking a sleeping page', async ({ appWindow, mcpPort, mcpToken }) => {
  const fixture = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end('<!doctype html><title>Preflight private title</title><main>Preflight private content</main>')
  })
  await new Promise<void>(resolve => fixture.listen(0, '127.0.0.1', resolve))
  const address = fixture.address()
  if (!address || typeof address === 'string') throw new Error('No fixture address')
  const origin = `http://127.0.0.1:${address.port}`
  const clients: Client[] = []
  const connect = async () => {
    const client = new Client({ name: 'preflight-qa', version: '1' })
    clients.push(client)
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort}/mcp`), {
      requestInit: { headers: { authorization: `Bearer ${mcpToken}` } }
    }))
    return client
  }
  const call = async <T>(client: Client, name: string, args: Record<string, unknown>): Promise<T> => {
    const result = await client.callTool({ name, arguments: args }) as CallToolResult
    const text = result.content.filter(part => part.type === 'text').map(part => part.text).join('\n')
    expect(result.isError, text).not.toBe(true)
    return JSON.parse(text) as T
  }
  try {
    await expect.poll(async () => {
      try { return (await fetch(`http://127.0.0.1:${mcpPort}/healthz`)).ok } catch { return false }
    }).toBe(true)
    const first = await connect()
    const workspace = await call<{ id: string; resumeKey: string }>(first, 'browser_workspaces', { action: 'create', storage: 'scratch', name: 'Private workspace canary' })
    const args = { workspaceId: workspace.id, expectedOrigin: origin }
    const state = await call<BrowserState>(first, 'browser_new_tab', { workspaceId: workspace.id, url: `${origin}/private-path?token=private-canary` })
    const tabId = state.activeTabId!
    const run = await call<{ id: string }>(first, 'browser_audit_receipts', { workspaceId: workspace.id, action: 'start' })
    const report = await call<Report>(first, 'browser_preflight', args)
    await call(first, 'browser_audit_receipts', { workspaceId: workspace.id, action: 'stop' })
    const receiptReport = await call<{ receipts: Array<{ event: { phase: string; toolName?: string; status?: string } }> }>(first, 'browser_audit_receipts', { workspaceId: workspace.id, action: 'read', runId: run.id })
    expect(receiptReport.receipts.map(receipt => receipt.event)).toEqual([
      expect.objectContaining({ phase: 'decision', toolName: 'browser_preflight' }),
      expect.objectContaining({ phase: 'outcome', status: 'succeeded' })
    ])
    expect(report.status).toBe('WARN')
    expect(report.checks).toContainEqual(expect.objectContaining({ reason: 'ORIGIN_MATCHED' }))
    expect(report.sessionEvidence.status).toBe('UNAVAILABLE')
    for (const value of [origin, 'private-path', 'private-canary', 'Preflight private', 'Private workspace canary', workspace.resumeKey, mcpToken]) {
      expect(JSON.stringify(report)).not.toContain(value)
    }
    const second = await connect()
    expect((await call<Report>(second, 'browser_preflight', args)).checks).toEqual([expect.objectContaining({ reason: 'WORKSPACE_UNAVAILABLE' })])
    const foreign = await call<{ id: string }>(second, 'browser_workspaces', { action: 'create', storage: 'scratch', name: 'Foreign preflight canary' })
    const foreignState = await call<BrowserState>(second, 'browser_new_tab', { workspaceId: foreign.id, url: 'about:blank' })
    expect((await call<Report>(first, 'browser_preflight', { ...args, tabId: foreignState.activeTabId })).checks).toContainEqual(expect.objectContaining({ reason: 'TAB_UNAVAILABLE' }))
    expect(await call<Report>(first, 'browser_preflight', { ...args, workspaceId: foreign.id })).toEqual(
      await call<Report>(first, 'browser_preflight', { ...args, workspaceId: 'a94f7c55-bc85-7da1-bd05-2bc4a1e0d125' })
    )
    await first.close()
    await call(second, 'browser_workspaces', { action: 'resume', workspaceId: workspace.id, resumeKey: workspace.resumeKey })
    expect((await call<Report>(second, 'browser_preflight', args)).checks).toContainEqual(expect.objectContaining({ reason: 'ORIGIN_MATCHED' }))
    await call(second, 'browser_new_tab', { workspaceId: workspace.id, url: origin })
    await expect.poll(() => appWindow.evaluate(`window.hronaut.getState().then(state => state.tabs.find(tab => tab.id === ${JSON.stringify(tabId)}).loading)`)).toBe(false)
    await appWindow.evaluate(`window.hronaut.setTabSleeping(${JSON.stringify(tabId)}, true)`)
    expect((await call<Report>(second, 'browser_preflight', { ...args, tabId })).checks).toContainEqual(expect.objectContaining({ reason: 'TAB_SLEEPING' }))
    expect(await appWindow.evaluate(`window.hronaut.getState().then(state => state.tabs.find(tab => tab.id === ${JSON.stringify(tabId)}).sleeping)`)).toBe(true)
    await appWindow.evaluate(`window.hronaut.updateWorkspaceNavigationPolicy(${JSON.stringify(workspace.id)}, { mode: 'restricted', rules: [${JSON.stringify(origin)}] })`)
    expect((await call<Report>(second, 'browser_preflight', { ...args, expectedOrigin: 'https://blocked.example' })).checks).toContainEqual(expect.objectContaining({ reason: 'SITE_BLOCKED' }))
    await call(second, 'browser_request_user_attention', { workspaceId: workspace.id, tabId, reason: 'Review the test fixture' })
    expect((await call<Report>(second, 'browser_preflight', args)).checks).toContainEqual(expect.objectContaining({ reason: 'HUMAN_STEP_REQUIRED' }))
    await appWindow.evaluate(`window.hronaut.updateTabGroup(${JSON.stringify(workspace.id)}, { agentAccess: false })`)
    expect((await call<Report>(second, 'browser_preflight', args)).checks).toEqual([expect.objectContaining({ reason: 'WORKSPACE_UNAVAILABLE' })])
    await appWindow.getByRole('button', { name: 'Pause agents', exact: true }).click()
    const paused = await fetch(`http://127.0.0.1:${mcpPort}/mcp`, {
      method: 'POST', headers: { authorization: `Bearer ${mcpToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'browser_preflight', arguments: args } })
    })
    expect(paused.status).toBe(503)
    expect(await paused.json()).toMatchObject({ preflight: { status: 'BLOCKED', reason: 'USER_PAUSED', writeSafety: 'NOT_ESTABLISHED' } })
  } finally {
    await Promise.allSettled(clients.map(client => client.close()))
    await closeFixtureServer(fixture)
  }
})
