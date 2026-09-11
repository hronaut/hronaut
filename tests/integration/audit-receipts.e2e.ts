import { createServer } from 'node:http'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { AuditReceipt } from '../../src/main/mcp/audit-receipt-store.js'
import type { HronautSettingsApi } from '../../src/shared/types.js'
import { closeFixtureServer, expect, test } from './fixtures.js'

const text = (result: CallToolResult): string => result.content.filter(part => part.type === 'text').map(part => part.text).join('\n')

test('records private bounded browser evidence across MCP reconnects without authorizing another workspace', async ({ appWindow, mcpPort, mcpToken }) => {
  const fixture = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end('<!doctype html><title>Private title canary</title><main>Private page content canary</main>')
  })
  await new Promise<void>(resolve => fixture.listen(0, '127.0.0.1', resolve))
  const address = fixture.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture address')
  const origin = `http://127.0.0.1:${address.port}`
  await appWindow.evaluate('window.hronautSettings.setMcpAuthentication(true)')
  const parent = await appWindow.evaluate(() => (
    window as unknown as { hronautSettings: HronautSettingsApi }
  ).hronautSettings.createMcpCapabilityProfile({
    name: 'Audit lineage parent', preset: 'complete', expiresInMinutes: 120
  }))
  const child = await appWindow.evaluate(parentProfileId => (
    window as unknown as { hronautSettings: HronautSettingsApi }
  ).hronautSettings.createMcpCapabilityProfile({
    name: 'Audit lineage child', preset: 'complete', parentProfileId, expiresInMinutes: 60
  }), parent.profile.id)
  const clients: Client[] = []
  const connect = async (): Promise<Client> => {
    const client = new Client({ name: 'audit-receipt-qa', version: '1' })
    clients.push(client)
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort}/mcp`), {
      requestInit: { headers: { authorization: `Bearer ${child.credential}` } }
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
      try {
        return (await fetch(`http://127.0.0.1:${mcpPort}/healthz`, {
          headers: { authorization: `Bearer ${mcpToken}` }
        })).ok
      } catch { return false }
    }).toBe(true)
    const first = await connect()
    const workspace = await call<{ id: string; resumeKey: string }>(first, 'browser_workspaces', {
      action: 'create', name: 'Audit fixture', storage: 'scratch'
    })
    const workspaceId = workspace.id
    expect(await call(first, 'browser_audit_receipts', { workspaceId, action: 'list' })).toEqual([])
    const run = await call<{ id: string }>(first, 'browser_audit_receipts', { workspaceId, action: 'start' })
    await call(first, 'browser_new_tab', { workspaceId, url: `${origin}/private-path-canary?token=private-query-canary` })
    await appWindow.evaluate(`window.hronaut.updateWorkspaceNavigationPolicy(${JSON.stringify(workspaceId)}, ${JSON.stringify({ mode: 'restricted', rules: [origin] })})`)
    const denied = await raw(first, 'browser_navigate', { workspaceId, url: 'https://blocked.example/private-denied-canary' })
    expect(denied.isError).toBe(true)
    await first.close()

    const resumed = await connect()
    expect((await raw(resumed, 'browser_audit_receipts', { workspaceId, action: 'read', runId: run.id })).isError).toBe(true)
    await call(resumed, 'browser_workspaces', { action: 'resume', workspaceId, resumeKey: workspace.resumeKey })
    expect((await call<{ id: string }>(resumed, 'browser_audit_receipts', { workspaceId, action: 'start' })).id).toBe(run.id)
    const snapshot = await raw(resumed, 'browser_snapshot', { workspaceId })
    expect(snapshot.isError, text(snapshot)).not.toBe(true)
    const foreign = await call<{ id: string }>(resumed, 'browser_workspaces', { action: 'create', name: 'Other audit fixture', storage: 'scratch' })
    expect((await raw(resumed, 'browser_audit_receipts', { workspaceId: foreign.id, action: 'read', runId: run.id })).isError).toBe(true)
    await call(resumed, 'browser_audit_receipts', { workspaceId, action: 'stop' })
    const report = await call<{
      run: { status: string }
      receipts: AuditReceipt[]
      evidenceCoverage: { items: Array<{ actionId: string | null; source: string; status: string; referenceId: string | null }> }
    }>(resumed, 'browser_audit_receipts', {
      workspaceId, action: 'read', runId: run.id
    })
    expect(report.run.status).toBe('stopped')
    const admissions = report.receipts.filter(receipt => receipt.event.phase === 'decision')
    expect(admissions.map(receipt => receipt.event.phase === 'decision' ? receipt.event.toolName : '')).toEqual([
      'browser_new_tab', 'browser_navigate', 'browser_snapshot'
    ])
    for (const receipt of admissions) {
      expect(receipt.event).toMatchObject({
        authorization: {
          kind: 'capability-profile',
          lineage: [
            { profileId: parent.profile.id, revision: parent.profile.revision },
            { profileId: child.profile.id, revision: child.profile.revision }
          ]
        }
      })
    }
    const failedId = admissions.find(receipt => receipt.event.phase === 'decision'
      && receipt.event.toolName === 'browser_navigate')!.event.actionId
    expect(report.receipts.some(receipt => receipt.event.phase === 'site-access'
      && receipt.event.actionId === failedId && receipt.event.decision === 'denied' && receipt.event.reason === 'no-match')).toBe(true)
    expect(report.receipts.some(receipt => receipt.event.phase === 'outcome'
      && receipt.event.actionId === failedId && receipt.event.status === 'failed')).toBe(true)
    const snapshotId = admissions.find(receipt => receipt.event.phase === 'decision'
      && receipt.event.toolName === 'browser_snapshot')!.event.actionId
    const diagnostic = report.evidenceCoverage.items.find(item => item.actionId === snapshotId
      && item.source === 'diagnostic' && item.status === 'available')
    expect(diagnostic?.referenceId).toEqual(expect.any(String))
    const resolved = await call<{ status: string; openWith: { toolName: string } }>(resumed, 'browser_audit_receipts', {
      workspaceId, action: 'evidence', runId: run.id, evidenceId: diagnostic!.referenceId
    })
    expect(resolved).toMatchObject({ status: 'available', openWith: { toolName: 'browser_debug_report' } })
    await call(resumed, 'browser_navigate', { workspaceId, url: `${origin}/generation-changed` })
    const expired = await call<{ status: string; reason: string; openWith?: unknown }>(resumed, 'browser_audit_receipts', {
      workspaceId, action: 'evidence', runId: run.id, evidenceId: diagnostic!.referenceId
    })
    expect(expired).toMatchObject({ status: 'expired', reason: 'navigation-changed' })
    expect(expired.openWith).toBeUndefined()
    const exported = JSON.stringify(report)
    for (const privateValue of [origin, 'blocked.example', 'private-path-canary', 'private-query-canary',
      'private-denied-canary', 'Private title canary', 'Private page content canary', workspace.resumeKey,
      mcpToken, parent.credential, child.credential, parent.profile.credentialId, child.profile.credentialId]) {
      expect(exported).not.toContain(privateValue)
    }
    const archiveRun = await call<{ id: string }>(resumed, 'browser_audit_receipts', { workspaceId, action: 'start' })
    await call(resumed, 'browser_saved_workspaces', { action: 'save', workspaceId })
    const archived = await call<{ run: { status: string } }>(resumed, 'browser_audit_receipts', {
      action: 'read', workspaceId, runId: archiveRun.id
    })
    expect(archived.run.status).toBe('stopped')
    expect((await raw(resumed, 'browser_audit_receipts', { action: 'start', workspaceId })).isError).toBe(true)
    const archiveReader = await connect()
    expect((await raw(archiveReader, 'browser_audit_receipts', { action: 'list', workspaceId })).isError).toBe(true)
    await call(archiveReader, 'browser_saved_workspaces', {
      action: 'resume', savedWorkspaceId: workspaceId, resumeKey: workspace.resumeKey
    })
    expect((await call<unknown[]>(archiveReader, 'browser_audit_receipts', { action: 'list', workspaceId })).length).toBe(2)
  } finally {
    await Promise.allSettled(clients.map(client => client.close()))
    await closeFixtureServer(fixture)
  }
})
