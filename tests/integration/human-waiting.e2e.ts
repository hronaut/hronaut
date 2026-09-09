import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createServer } from 'node:http'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { HumanWaitingRecord } from '../../src/shared/human-waiting.js'
import type { HronautApi } from '../../src/shared/types.js'
import { closeFixtureServer, closeHronaut, launchHronaut, expect, test } from './fixtures.js'

test('keeps tabless human decisions discoverable after reconnect and reserves acknowledgement for the human', async ({ appWindow, electronApp, mcpPort, mcpToken }) => {
  const clients: Client[] = []
  const connect = async () => {
    const client = new Client({ name: 'human-waiting-qa', version: '1' })
    clients.push(client)
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort}/mcp`), { requestInit: { headers: { authorization: `Bearer ${mcpToken}` } } }))
    return client
  }
  const call = (client: Client, name: string, args: Record<string, unknown>) => client.callTool({ name, arguments: args }) as Promise<CallToolResult>
  const decode = <T>(result: CallToolResult): T => {
    const value = result.content.filter(part => part.type === 'text').map(part => part.text).join('\n')
    if (result.isError) throw new Error(value)
    return JSON.parse(value) as T
  }
  try {
    await expect.poll(async () => { try { return (await fetch(`http://127.0.0.1:${mcpPort}/healthz`)).ok } catch { return false } }).toBe(true)
    const first = await connect()
    const workspace = decode<{ id: string; resumeKey: string }>(await call(first, 'browser_workspaces', { action: 'create', storage: 'scratch', name: 'Human decision QA' }))
    const args = { workspaceId: workspace.id }
    const waiting = decode<HumanWaitingRecord>(await call(first, 'browser_human_waiting', { ...args, action: 'request', runId: randomUUID(), decision: 'resolve-unknown', owner: 'QA operator', fallbackOwner: 'QA fallback', timeoutMs: 60_000 }))
    expect(waiting).toMatchObject({ state: 'WAITING_FOR_HUMAN', notificationAttempts: 1, notificationStatus: 'delivered', priorOutcome: 'OUTCOME_UNKNOWN' })
    expect((await call(first, 'browser_human_waiting', { ...args, action: 'acknowledge', id: waiting.id, revision: waiting.revision })).isError).toBe(true)
    await first.close()
    const second = await connect()
    expect((await call(second, 'browser_human_waiting', { ...args, action: 'list' })).isError).toBe(true)
    decode(await call(second, 'browser_workspaces', { action: 'resume', ...args, resumeKey: workspace.resumeKey }))
    expect(decode<HumanWaitingRecord[]>(await call(second, 'browser_human_waiting', { ...args, action: 'list' }))).toEqual([waiting])
    await electronApp.evaluate(({ BrowserWindow }, id) => BrowserWindow.getAllWindows()[0]!.webContents.send('browser:edit-tab-group', id), workspace.id)
    const editor = appWindow.getByRole('dialog', { name: 'Edit workspace', exact: true })
    const panel = editor.getByRole('region', { name: 'Human decisions', exact: true })
    await expect(panel.getByText('QA operator', { exact: true })).toBeVisible()
    await expect(panel.getByText('QA fallback', { exact: true })).toBeVisible()
    await panel.getByRole('button', { name: 'Acknowledge', exact: true }).click()
    await expect(panel.getByText('Acknowledged; review pending', { exact: true })).toBeVisible()
    const acknowledged = decode<HumanWaitingRecord[]>(await call(second, 'browser_human_waiting', { ...args, action: 'list' }))[0]!
    expect(acknowledged).toMatchObject({ state: 'ACKNOWLEDGED', priorOutcome: 'OUTCOME_UNKNOWN' })
    expect(acknowledged.revision).not.toBe(waiting.revision)
    await panel.getByRole('checkbox').check()
    await panel.getByRole('button', { name: 'Complete review', exact: true }).click()
    await expect(panel.getByRole('alert')).toContainText('Refresh and review')
    expect(decode<HumanWaitingRecord[]>(await call(second, 'browser_human_waiting', { ...args, action: 'list' }))[0]!.state).toBe('ACKNOWLEDGED')
    await panel.getByRole('button', { name: 'Cancel decision', exact: true }).click()
    await expect(panel.getByText('Cancelled', { exact: true })).toBeVisible()
    expect(decode<HumanWaitingRecord[]>(await call(second, 'browser_human_waiting', { ...args, action: 'list' }))[0]).toMatchObject({ state: 'CANCELLED', priorOutcome: 'OUTCOME_UNKNOWN' })
    const older = decode<HumanWaitingRecord>(await call(second, 'browser_human_waiting', { ...args, action: 'request', runId: randomUUID(), decision: 'review-page' }))
    decode(await call(second, 'browser_human_waiting', { ...args, action: 'request', runId: randomUUID(), decision: 'provide-input' }))
    const before = decode<{ userAttention: { id: string } | null }>(await call(second, 'browser_status', args))
    expect(before.userAttention).not.toBeNull()
    await appWindow.evaluate(record => (window as unknown as { hronaut: HronautApi }).hronaut.changeHumanWaiting(record.workspaceId, record.id, record.revision, 'acknowledge'), older)
    const after = decode<{ userAttention: { id: string } | null }>(await call(second, 'browser_status', args))
    expect(after.userAttention?.id).toBe(before.userAttention!.id)
  } finally {
    await Promise.allSettled(clients.map(client => client.close()))
  }
})

test('restores unresolved decisions with a fresh review handle and persists unattended expiry', async ({ profileDirectory, mcpPort }) => {
  let instance = await launchHronaut(profileDirectory, mcpPort)
  const token = (await readFile(join(profileDirectory, 'mcp-token'), 'utf8')).trim()
  const clients: Client[] = []
  const connect = async () => {
    await expect.poll(async () => { try { return (await fetch(`http://127.0.0.1:${mcpPort}/healthz`)).ok } catch { return false } }).toBe(true)
    const client = new Client({ name: 'waiting-restart-qa', version: '1' }); clients.push(client)
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort}/mcp`), { requestInit: { headers: { authorization: `Bearer ${token}` } } }))
    return client
  }
  const call = async <T>(client: Client, name: string, args: Record<string, unknown>): Promise<T> => {
    const result = await client.callTool({ name, arguments: args }) as CallToolResult
    const value = result.content.filter(part => part.type === 'text').map(part => part.text).join('\n')
    expect(result.isError, value).not.toBe(true)
    return JSON.parse(value) as T
  }
  try {
    const first = await connect()
    const workspace = await call<{ id: string; resumeKey: string }>(first, 'browser_workspaces', { action: 'create', storage: 'scratch', name: 'Persistent decision QA' })
    const args = { workspaceId: workspace.id }
    const waiting = await call<HumanWaitingRecord>(first, 'browser_human_waiting', { ...args, action: 'request', runId: randomUUID(), decision: 'review-page', timeoutMs: 60_000 })
    const acknowledged = await instance.window.evaluate(record => (window as unknown as { hronaut: HronautApi }).hronaut.changeHumanWaiting(record.workspaceId, record.id, record.revision, 'acknowledge'), waiting)
    expect(acknowledged.state).toBe('ACKNOWLEDGED')
    await first.close(); await closeHronaut(instance.app)
    instance = await launchHronaut(profileDirectory, mcpPort)
    const second = await connect()
    await call(second, 'browser_workspaces', { ...args, action: 'resume', resumeKey: workspace.resumeKey })
    const restored = (await call<HumanWaitingRecord[]>(second, 'browser_human_waiting', { ...args, action: 'list' }))[0]!
    expect(restored).toMatchObject({ id: waiting.id, state: 'WAITING_FOR_HUMAN', priorOutcome: 'OUTCOME_UNKNOWN', deadlineAt: waiting.deadlineAt })
    expect(restored.revision).not.toBe(acknowledged.revision)
    const staleRejected = await instance.window.evaluate(async record => {
      try { await (window as unknown as { hronaut: HronautApi }).hronaut.changeHumanWaiting(record.workspaceId, record.id, record.revision, 'acknowledge'); return false } catch { return true }
    }, acknowledged)
    expect(staleRejected).toBe(true)
    await call(second, 'browser_human_waiting', { ...args, action: 'cancel', id: restored.id, revision: restored.revision })
    const expiring = await call<HumanWaitingRecord>(second, 'browser_human_waiting', { ...args, action: 'request', runId: randomUUID(), decision: 'review-page', timeoutMs: 1000 })
    await expect.poll(async () => (await call<HumanWaitingRecord[]>(second, 'browser_human_waiting', { ...args, action: 'list' })).find(record => record.id === expiring.id)?.state).toBe('EXPIRED')
    const saved = JSON.parse(await readFile(join(profileDirectory, 'human-waiting.json'), 'utf8')) as { records: HumanWaitingRecord[] }
    expect(saved.records.find(record => record.id === expiring.id)).toMatchObject({ state: 'EXPIRED', priorOutcome: 'OUTCOME_UNKNOWN', nextAction: 'MAKE_FRESH_DECISION' })
  } finally {
    await Promise.allSettled(clients.map(client => client.close()))
    await closeHronaut(instance.app)
  }
})

test('completes a fresh human review without replaying the page action', async ({ appWindow, electronApp, mcpPort, mcpToken }, testInfo) => {
  const fixture = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end('<!doctype html><title>Human review fixture</title><input id="draft" value="unsaved draft"><button onclick="window.writes++">Submit</button><script>window.writes=0</script>')
  })
  await new Promise<void>(resolve => fixture.listen(0, '127.0.0.1', resolve))
  const address = fixture.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture address')
  const origin = `http://127.0.0.1:${address.port}`
  const client = new Client({ name: 'fresh-human-review-qa', version: '1' })
  const call = async (name: string, args: Record<string, unknown>): Promise<CallToolResult> => await client.callTool({ name, arguments: args }) as CallToolResult
  const decode = <T>(result: CallToolResult): T => {
    const value = result.content.filter(part => part.type === 'text').map(part => part.text).join('\n')
    expect(result.isError, value).not.toBe(true)
    return JSON.parse(value) as T
  }
  const pageState = () => electronApp.evaluate(async ({ webContents }, origin) => {
    const page = webContents.getAllWebContents().find(contents => contents.getURL().startsWith(origin))
    if (!page) throw new Error('Missing fixture page')
    return page.executeJavaScript('({writes:window.writes,draft:document.querySelector("#draft").value})') as Promise<{ writes: number; draft: string }>
  }, origin)
  try {
    await expect.poll(async () => { try { return (await fetch(`http://127.0.0.1:${mcpPort}/healthz`)).ok } catch { return false } }).toBe(true)
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort}/mcp`), { requestInit: { headers: { authorization: `Bearer ${mcpToken}` } } }))
    const workspace = decode<{ id: string }>(await call('browser_workspaces', { action: 'create', storage: 'scratch', name: 'Fresh review QA' }))
    const args = { workspaceId: workspace.id }
    decode(await call('browser_new_tab', { ...args, url: origin }))
    await expect.poll(() => pageState().catch(() => null)).toEqual({ writes: 0, draft: 'unsaved draft' })
    decode(await call('browser_continuity', { ...args, action: 'checkpoint' }))
    decode(await call('browser_human_waiting', { ...args, action: 'request', runId: randomUUID(), decision: 'approve-action', timeoutMs: 60_000 }))
    expect((await call('browser_click', { ...args, selector: 'button' })).isError).toBe(true)
    await electronApp.evaluate(({ BrowserWindow }, id) => BrowserWindow.getAllWindows()[0]!.webContents.send('browser:edit-tab-group', id), workspace.id)
    const editor = appWindow.getByRole('dialog', { name: 'Edit workspace', exact: true })
    const continuity = editor.getByRole('region', { name: 'Workspace continuity', exact: true })
    await continuity.getByRole('button', { name: 'Read current state', exact: true }).click()
    await continuity.getByRole('checkbox').check()
    await continuity.getByRole('button', { name: 'Confirm reviewed state', exact: true }).click()
    await expect(continuity.getByRole('status')).toHaveText('Review guard cleared; recheck before a fresh action')
    const waiting = editor.getByRole('region', { name: 'Human decisions', exact: true })
    await waiting.getByRole('checkbox').check()
    await waiting.getByRole('button', { name: 'Complete review', exact: true }).click()
    await expect(waiting.getByText('Review completed', { exact: true })).toBeVisible()
    expect(decode<HumanWaitingRecord[]>(await call('browser_human_waiting', { ...args, action: 'list' }))[0]).toMatchObject({ state: 'RESOLVED', priorOutcome: 'OUTCOME_UNKNOWN' })
    expect(await pageState()).toEqual({ writes: 0, draft: 'unsaved draft' })
    await appWindow.screenshot({ path: testInfo.outputPath('human-waiting-completed.png') })
  } finally {
    await client.close()
    await closeFixtureServer(fixture)
  }
})
