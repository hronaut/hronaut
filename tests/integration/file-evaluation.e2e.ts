import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { HronautSettingsApi, HronautApi } from '../../src/shared/types.js'
import type { FileEvaluationSource } from '../../src/shared/file-evaluation.js'
import { connectMcpWorkspace } from '../../scripts/mcp-workspace.js'
import { test as base, expect, closeFixtureServer } from './fixtures.js'

type Probe = { opens: number; submissions: Array<{ unique: boolean; expressionMatches: boolean }>; held: boolean; mode: 'none' | 'preparation' | 'result'; holdOpen: boolean; heldOpens: number; handles: Array<{ fd: number }>; release(): void; restore(): void }
type Scope = typeof globalThis & { fileProbe?: Probe }
const code = 'globalThis.__fileRuns = (globalThis.__fileRuns || 0) + 1; ({runs:globalThis.__fileRuns, text:"🛰️\\nexact"})'
const failingCode = 'throw new Error("synthetic-source-exception-secret")'
const text = (result: CallToolResult): string => result.content.filter(item => item.type === 'text').map(item => item.text).join('\n')
const test = base.extend<{ evaluation: { client: Client; full: Client; source: FileEvaluationSource; profileId: string; url: string; reconnect(): Promise<Client> } }>({
  evaluation: async ({ appWindow, mcpPort, mcpToken, profileDirectory, electronApp }, use) => {
    const server = createServer((_req, res) => { res.setHeader('content-type', 'text/html'); res.end('<title>File source fixture</title><p>Synthetic source target</p>') })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address() as { port: number }
    const origin = `http://127.0.0.1:${address.port}`; const url = `${origin}/`
    const connect = async (token: string): Promise<Client> => {
      const client = new Client({ name: 'file-source-test', version: '1' })
      await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort}/mcp`), { requestInit: { headers: { authorization: `Bearer ${token}` } } }))
      return client
    }
    let full: Client | undefined; let client: Client | undefined
    try {
      await expect.poll(async () => {
        try { return (await fetch(`http://127.0.0.1:${mcpPort}/healthz`, { headers: { authorization: `Bearer ${mcpToken}` } })).ok } catch { return false }
      }).toBe(true)
      await appWindow.evaluate(() => (window as unknown as { hronautSettings: HronautSettingsApi }).hronautSettings.setMcpAuthentication(true))
      full = await connect(mcpToken)
      const workspace = await connectMcpWorkspace(full, 'File source tests', false)
      const opened = await full.callTool({ name: 'browser_new_tab', arguments: { url, active: true } }) as CallToolResult
      expect(opened.isError, text(opened)).not.toBe(true)
      const tabId = JSON.parse(text(opened)).activeTabId as string
      await full.callTool({ name: 'browser_wait', arguments: { tabId } })
      const path = join(profileDirectory, 'synthetic-private-source.js'); await writeFile(path, code)
      const source: FileEvaluationSource = { path, sha256: createHash('sha256').update(code).digest('hex'), workspaceId: workspace.workspaceId, tabId, expectedOrigin: origin }
      const grant = await appWindow.evaluate(({ source, errorDigest }) => (window as unknown as { hronautSettings: HronautSettingsApi }).hronautSettings.createMcpCapabilityProfile({
        name: 'Exact file tuple', preset: 'complete', argumentConstraints: { 'browser_evaluate_file.source': [source, { ...source, sha256: errorDigest }] }
      }), { source, errorDigest: createHash('sha256').update(failingCode).digest('hex') })
      await full.callTool({ name: 'browser_workspaces', arguments: { action: 'release-ownership', workspaceId: workspace.workspaceId } })
      client = await connect(grant.credential)
      await connectMcpWorkspace(client, 'File source resumed', false, workspace)
      await electronApp.evaluate(({ webContents }, { url, code }) => {
        const fs = process.getBuiltinModule('node:fs/promises') as typeof import('node:fs/promises')
        const { syncBuiltinESMExports } = process.getBuiltinModule('module') as typeof import('node:module')
        const open = fs.open
        const page = webContents.getAllWebContents().find(contents => contents.getURL() === url)!
        const send = page.debugger.sendCommand
        const probe: Probe = { opens: 0, submissions: [], held: false, mode: 'none', holdOpen: false, heldOpens: 0, handles: [], release: () => undefined, restore: () => { fs.open = open; syncBuiltinESMExports(); if (!page.isDestroyed()) page.debugger.sendCommand = send } }
        ;(globalThis as Scope).fileProbe = probe
        let release!: () => void
        const heldOpen = new Promise<void>(resolve => { release = resolve })
        probe.release = release
        fs.open = async (...args: Parameters<typeof open>) => {
          if (typeof args[1] === 'number' && (args[1] & 0x200000) !== 0 || String(args[0]).startsWith('/proc/self/fd/')) probe.opens++
          const handle = await open(...args)
          if (probe.holdOpen && typeof args[1] === 'number' && (args[1] & 0x200000) !== 0) {
            probe.handles.push(handle); probe.heldOpens++; await heldOpen
          }
          return handle
        }
        syncBuiltinESMExports()
        page.debugger.sendCommand = async (method, ...args) => {
          if (method === 'Runtime.evaluate' && args[0]?.expression === code) probe.submissions.push({ unique: typeof args[0]?.uniqueContextId === 'string' && args[0]?.contextId === undefined, expressionMatches: true })
          const response = await send.call(page.debugger, method, ...args)
          if (probe.mode === 'preparation' && method === 'Page.getFrameTree' || probe.mode === 'result' && method === 'Runtime.evaluate' && args[0]?.expression === code) {
            probe.held = true; await heldOpen
          }
          return response
        }
      }, { url, code })
      await use({ client, full, source, profileId: grant.profile.id, url, reconnect: async () => {
        await client!.callTool({ name: 'browser_workspaces', arguments: { action: 'release-ownership', workspaceId: workspace.workspaceId } })
        await client!.close(); client = await connect(grant.credential)
        await connectMcpWorkspace(client, 'Reconnected file source', false, workspace)
        return client
      } })
    } finally {
      await electronApp.evaluate(() => { (globalThis as Scope).fileProbe?.release(); (globalThis as Scope).fileProbe?.restore() }).catch(() => undefined)
      await client?.close().catch(() => undefined); await full?.close().catch(() => undefined)
      await closeFixtureServer(server)
    }
  }
})

test('executes the exact captured source once in a unique context', async ({ evaluation, electronApp }) => {
  const result = await evaluation.client.callTool({ name: 'browser_evaluate_file', arguments: { tabId: evaluation.source.tabId, source: evaluation.source } }) as CallToolResult
  expect(result.isError, text(result)).not.toBe(true)
  expect(result.structuredContent).toMatchObject({ status: 'RETURNED', submitted: true, acknowledged: true, value: { runs: 1, text: '🛰️\nexact' } })
  const probe = await electronApp.evaluate(() => { const p = (globalThis as Scope).fileProbe!; return { opens: p.opens, submissions: p.submissions } })
  expect(probe.opens).toBeGreaterThan(0)
  expect(probe.submissions).toEqual([{ unique: true, expressionMatches: true }])
})

test('denies compatibility and every tuple substitution before filesystem access', async ({ evaluation, electronApp }) => {
  const { source } = evaluation
  const requests = [
    { client: evaluation.full, source },
    ...Object.entries({ path: `${source.path}.other`, sha256: '0'.repeat(64), workspaceId: '01912345-6789-7abc-8def-0123456789ab', tabId: 'other-tab', expectedOrigin: 'https://other.example' }).map(([key, value]) => ({ client: evaluation.client, source: { ...source, [key]: value } })),
    { client: evaluation.client, source: { ...source, unexpected: true } }
  ]
  for (const request of requests) {
    const result = await request.client.callTool({ name: 'browser_evaluate_file', arguments: { tabId: source.tabId, source: request.source } }) as CallToolResult
    expect(result.isError, text(result)).toBe(true)
    expect(text(result)).not.toContain(source.path)
  }
  expect(await electronApp.evaluate(() => (globalThis as Scope).fileProbe!.opens)).toBe(0)
  expect(await electronApp.evaluate(() => (globalThis as Scope).fileProbe!.submissions)).toEqual([])
})


test('retains process-wide acquisition capacity until late native handles close', async ({ evaluation, electronApp }) => {
  await electronApp.evaluate(() => { (globalThis as Scope).fileProbe!.holdOpen = true })
  const request = { name: 'browser_evaluate_file', arguments: { tabId: evaluation.source.tabId, source: evaluation.source } }
  const first = evaluation.client.callTool(request) as Promise<CallToolResult>
  await expect.poll(() => electronApp.evaluate(() => (globalThis as Scope).fileProbe!.heldOpens)).toBe(1)
  expect((await first).structuredContent).toMatchObject({ status: 'NOT_DISPATCHED', submitted: false })
  const reconnected = await evaluation.reconnect()
  const second = reconnected.callTool(request) as Promise<CallToolResult>
  await expect.poll(() => electronApp.evaluate(() => (globalThis as Scope).fileProbe!.heldOpens)).toBe(2)
  for (const result of [await second]) expect(result.structuredContent).toMatchObject({ status: 'NOT_DISPATCHED', submitted: false })
  const opens = await electronApp.evaluate(() => (globalThis as Scope).fileProbe!.opens)
  const third = await reconnected.callTool(request) as CallToolResult
  expect(third.structuredContent).toMatchObject({ status: 'NOT_DISPATCHED', reason: 'BUSY' })
  expect(await electronApp.evaluate(() => (globalThis as Scope).fileProbe!.opens)).toBe(opens)
  await electronApp.evaluate(() => { const probe = (globalThis as Scope).fileProbe!; probe.holdOpen = false; probe.release() })
  await expect.poll(() => electronApp.evaluate(() => (globalThis as Scope).fileProbe!.handles.every(handle => handle.fd === -1))).toBe(true)
  const fresh = await reconnected.callTool(request) as CallToolResult
  expect(fresh.structuredContent).toMatchObject({ status: 'RETURNED', value: { runs: 1 } })
})


for (const change of ['unchanged', 'pause-aba', 'navigation', 'revoke', 'review-read'] as const) {
  test(`checks current document and authority after debugger preparation: ${change}`, async ({ evaluation, electronApp, appWindow }) => {
    await electronApp.evaluate(() => { (globalThis as Scope).fileProbe!.mode = 'preparation' })
    const pending = evaluation.client.callTool({ name: 'browser_evaluate_file', arguments: { tabId: evaluation.source.tabId, source: evaluation.source } }) as Promise<CallToolResult>
    await expect.poll(() => electronApp.evaluate(() => (globalThis as Scope).fileProbe!.held)).toBe(true)
    if (change === 'pause-aba') await appWindow.evaluate(async id => {
      const api = (window as unknown as { hronaut: HronautApi }).hronaut
      await api.setTabAgentPaused(id, true); await api.setTabAgentPaused(id, false)
    }, evaluation.source.tabId)
    if (change === 'navigation') await electronApp.evaluate(async ({ webContents }, url) => {
      await webContents.getAllWebContents().find(page => page.getURL() === url)!.loadURL(`${url}?replacement=1`)
    }, evaluation.url)
    if (change === 'review-read') await appWindow.evaluate(id => (window as unknown as { hronaut: HronautApi }).hronaut.listHumanWaiting(id), evaluation.source.workspaceId)
    if (change === 'revoke') await appWindow.evaluate(id => (window as unknown as { hronautSettings: HronautSettingsApi }).hronautSettings.revokeMcpCapabilityProfile(id), evaluation.profileId)
    await electronApp.evaluate(() => (globalThis as Scope).fileProbe!.release())
    const result = await pending
    expect(result.structuredContent).toMatchObject({ status: change === 'unchanged' ? 'RETURNED' : 'NOT_DISPATCHED', submitted: change === 'unchanged' })
    expect(await electronApp.evaluate(() => (globalThis as Scope).fileProbe!.submissions.length)).toBe(change === 'unchanged' ? 1 : 0)
  })
}

test('reports uncertainty after actual submission without replay or source disclosure', async ({ evaluation, electronApp, appWindow }) => {
  await electronApp.evaluate(() => { (globalThis as Scope).fileProbe!.mode = 'result' })
  const pending = evaluation.client.callTool({ name: 'browser_evaluate_file', arguments: { tabId: evaluation.source.tabId, source: evaluation.source } }) as Promise<CallToolResult>
  await expect.poll(() => electronApp.evaluate(() => (globalThis as Scope).fileProbe!.held)).toBe(true)
  await appWindow.evaluate(id => (window as unknown as { hronaut: HronautApi }).hronaut.setTabAgentPaused(id, true), evaluation.source.tabId)
  await electronApp.evaluate(() => (globalThis as Scope).fileProbe!.release())
  const result = await pending
  expect(result.structuredContent).toMatchObject({ status: 'OUTCOME_UNKNOWN', submitted: true, retrySafe: false })
  expect(text(result)).not.toContain(evaluation.source.path); expect(text(result)).not.toContain(code)
  expect(await electronApp.evaluate(() => (globalThis as Scope).fileProbe!.submissions.length)).toBe(1)
  expect(await electronApp.evaluate(({ webContents }, url) => webContents.getAllWebContents().find(page => page.getURL() === url)!.executeJavaScript('globalThis.__fileRuns'), evaluation.url)).toBe(1)
})


test('ordinary complete profiles grant no host-file access', async ({ evaluation, appWindow, mcpPort, electronApp }) => {
  const grant = await appWindow.evaluate(() => (window as unknown as { hronautSettings: HronautSettingsApi }).hronautSettings.createMcpCapabilityProfile({ name: 'Ordinary inline access', preset: 'complete' }))
  const client = new Client({ name: 'ordinary-profile', version: '1' })
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort}/mcp`), { requestInit: { headers: { authorization: `Bearer ${grant.credential}` } } }))
    const names = (await client.listTools()).tools.map(tool => tool.name)
    expect(names).toContain('browser_evaluate'); expect(names).not.toContain('browser_evaluate_file')
    const result = await client.callTool({ name: 'browser_evaluate_file', arguments: { workspaceId: evaluation.source.workspaceId, tabId: evaluation.source.tabId, source: evaluation.source } }) as CallToolResult
    expect(result.isError).toBe(true)
    expect(await electronApp.evaluate(() => (globalThis as Scope).fileProbe!.opens)).toBe(0)
  } finally { await client.close() }
})

test('sanitizes script exceptions and automatic audit output', async ({ evaluation, profileDirectory }) => {
  await writeFile(evaluation.source.path, failingCode)
  const source = { ...evaluation.source, sha256: createHash('sha256').update(failingCode).digest('hex') }
  const started = await evaluation.client.callTool({ name: 'browser_audit_receipts', arguments: { action: 'start' } }) as CallToolResult
  expect(started.isError, text(started)).not.toBe(true)
  const runId = JSON.parse(text(started)).id as string
  const result = await evaluation.client.callTool({ name: 'browser_evaluate_file', arguments: { tabId: source.tabId, source } }) as CallToolResult
  expect(result.structuredContent).toMatchObject({ status: 'OUTCOME_UNKNOWN', reason: 'SCRIPT_FAILED', submitted: true, acknowledged: true, retrySafe: false })
  const audit = await evaluation.client.callTool({ name: 'browser_audit_receipts', arguments: { action: 'read', runId } }) as CallToolResult
  const consoleResult = await evaluation.client.callTool({ name: 'browser_console', arguments: { tabId: source.tabId } }) as CallToolResult
  const persisted = await readFile(join(profileDirectory, 'mcp-capability-profiles.json'), 'utf8')
  for (const receipt of [text(result), text(audit), text(consoleResult), persisted]) {
    expect(receipt).not.toContain(source.path)
    expect(receipt).not.toContain('synthetic-source-exception-secret')
  }
})


for (const phase of ['preparation', 'result'] as const) {
  test(`cancellation preserves actual submission evidence during ${phase}`, async ({ evaluation, electronApp }) => {
    await electronApp.evaluate((_electron, phase) => { (globalThis as Scope).fileProbe!.mode = phase }, phase)
    const transport = evaluation.client.transport!
    const originalSend = transport.send.bind(transport)
    let requestId: string | number | undefined
    transport.send = async (message, options) => {
      if ('method' in message && message.method === 'tools/call' && 'id' in message && message.params?.name === 'browser_evaluate_file') requestId = message.id
      return originalSend(message, options)
    }
    const abort = new AbortController()
    const pending = evaluation.client.callTool({ name: 'browser_evaluate_file', arguments: { tabId: evaluation.source.tabId, source: evaluation.source } }, undefined, { signal: abort.signal }).catch(() => undefined)
    await expect.poll(() => electronApp.evaluate(() => (globalThis as Scope).fileProbe!.held)).toBe(true)
    expect(requestId).toBeDefined()
    await evaluation.client.notification({ method: 'notifications/cancelled', params: { requestId: requestId!, reason: 'Synthetic cancellation' } })
    abort.abort(); await pending
    await electronApp.evaluate(() => (globalThis as Scope).fileProbe!.release())
    await expect.poll(() => electronApp.evaluate(async ({ webContents }, tabId) => {
      const home = webContents.getAllWebContents().find(page => page.getURL().startsWith('hronaut://home'))!
      const status = await (await home.session.fetch('hronaut://home/api/status')).json() as { recentActivity: Array<{ toolName: string; tabId: string; result?: { outcome?: string; dispatch?: string; effects?: string } }> }
      return status.recentActivity.find(item => item.toolName === 'browser_evaluate_file' && item.tabId === tabId)?.result
    }, evaluation.source.tabId)).toMatchObject({ outcome: 'cancelled', dispatch: phase === 'result' ? 'dispatched' : 'not-dispatched', effects: phase === 'result' ? 'possible' : 'none' })
    expect(await electronApp.evaluate(() => (globalThis as Scope).fileProbe!.submissions.length)).toBe(phase === 'result' ? 1 : 0)
  })
}
