import { createHash, randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { readFile, writeFile, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { HronautSettingsApi, HronautApi } from '../../src/shared/types.js'
import type { HumanWaitingRecord } from '../../src/shared/human-waiting.js'
import type { FileEvaluationSource } from '../../src/shared/file-evaluation.js'
import { connectMcpWorkspace } from '../../scripts/mcp-workspace.js'
import { test as base, expect, closeFixtureServer } from './fixtures.js'

type Probe = { holdClose: boolean; heldCloses: number; failReviewSave: boolean; reviewSaveFailures: number; opens: number; submissions: Array<{ unique: boolean; expressionMatches: boolean }>; held: boolean; mode: 'none' | 'preparation' | 'result' | 'audit'; holdOpen: boolean; heldOpens: number; handles: Array<{ fd: number }>; release(): void; restore(): void }
type Scope = typeof globalThis & { fileProbe?: Probe }
const code = 'globalThis.__fileRuns = (globalThis.__fileRuns || 0) + 1; ({runs:globalThis.__fileRuns, text:"🛰️\\nexact"})'
const failingCode = 'throw new Error("synthetic-source-exception-secret")'
const text = (result: CallToolResult): string => result.content.filter(item => item.type === 'text').map(item => item.text).join('\n')
const test = base.extend<{ evaluation: { client: Client; full: Client; source: FileEvaluationSource; profileId: string; url: string; reload: { hold(): void; requested(): boolean; release(): void }; connectAgain(): Promise<Client>; reconnect(): Promise<Client> } }>({
  evaluation: async ({ appWindow, mcpPort, mcpToken, profileDirectory, electronApp }, use) => {
    let holdReload = false; let reloadRequested = false; let releaseReload = (): void => undefined; let documentVersion = 0
    const server = createServer((req, res) => {
      if (req.url === '/favicon.ico') { res.writeHead(404); res.end(); return }
      const version = ++documentVersion
      const reply = (): void => {
        if (res.writableEnded) return
        res.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' })
        res.end(`<title>File source fixture</title><p>Synthetic source target</p><script>window.__documentVersion=${version}</script>`)
      }
      if (holdReload) { releaseReload = reply; reloadRequested = true } else reply()
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address() as { port: number }
    const origin = `http://127.0.0.1:${address.port}`; const url = `${origin}/`
    const connect = async (token: string): Promise<Client> => {
      const client = new Client({ name: 'file-source-test', version: '1' })
      await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort}/mcp`), { requestInit: { headers: { authorization: `Bearer ${token}` } } }))
      return client
    }
    const extraClients: Client[] = []
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
      await electronApp.evaluate(({ webContents }, { url, code, failingCode }) => {
        const fs = process.getBuiltinModule('node:fs/promises') as typeof import('node:fs/promises')
        const { syncBuiltinESMExports } = process.getBuiltinModule('module') as typeof import('node:module')
        const open = fs.open; const rename = fs.rename
        const page = webContents.getAllWebContents().find(contents => contents.getURL() === url)!
        const send = page.debugger.sendCommand
        const probe: Probe = { holdClose: false, heldCloses: 0, failReviewSave: false, reviewSaveFailures: 0, opens: 0, submissions: [], held: false, mode: 'none', holdOpen: false, heldOpens: 0, handles: [], release: () => undefined, restore: () => { fs.open = open; fs.rename = rename; syncBuiltinESMExports(); if (!page.isDestroyed()) page.debugger.sendCommand = send } }
        ;(globalThis as Scope).fileProbe = probe
        let release!: () => void
        const heldOpen = new Promise<void>(resolve => { release = resolve })
        probe.release = release
        let auditActionId = ''
        fs.open = async (...args: Parameters<typeof open>) => {
          if (typeof args[1] === 'number' && (args[1] & 0x200000) !== 0 || String(args[0]).startsWith('/proc/self/fd/')) probe.opens++
          const handle = await open(...args)
          if (String(args[0]).includes('/audit-receipts/') && args[1] === 'a') {
            const write = handle.writeFile.bind(handle)
            handle.writeFile = async (data, options) => {
              const event = JSON.parse(String(data)).event as { phase: string; toolName?: string; actionId?: string }
              if (event.phase === 'decision' && event.toolName === 'browser_evaluate_file') auditActionId = event.actionId!
              if (probe.mode === 'audit' && event.phase === 'outcome' && event.actionId === auditActionId && !probe.held) {
                probe.held = true; await heldOpen
              }
              return write(data, options)
            }
          }
          if (probe.holdClose && String(args[0]).startsWith('/proc/self/fd/') && typeof args[1] === 'number' && (args[1] & 0x200000) === 0) {
            const close = handle.close.bind(handle)
            handle.close = async () => { probe.handles.push(handle); probe.heldCloses++; await heldOpen; return close() }
          }
          if (probe.holdOpen && typeof args[1] === 'number' && (args[1] & 0x200000) !== 0) {
            probe.handles.push(handle); probe.heldOpens++; await heldOpen
          }
          return handle
        }
        fs.rename = async (from, to) => {
          if (probe.failReviewSave && probe.submissions.length && String(to).endsWith('/human-waiting.json')) {
            probe.reviewSaveFailures++; throw new Error('synthetic-review-persistence-secret')
          }
          return rename(from, to)
        }
        syncBuiltinESMExports()
        page.debugger.sendCommand = async (method, ...args) => {
          if (method === 'Runtime.evaluate' && (args[0]?.expression === code || args[0]?.expression === failingCode)) probe.submissions.push({ unique: typeof args[0]?.uniqueContextId === 'string' && args[0]?.contextId === undefined, expressionMatches: true })
          const response = await send.call(page.debugger, method, ...args)
          if (probe.mode === 'preparation' && method === 'Page.getFrameTree' || probe.mode === 'result' && method === 'Runtime.evaluate' && args[0]?.expression === code) {
            probe.held = true; await heldOpen
          }
          return response
        }
      }, { url, code, failingCode })
      await use({ client, full, source, profileId: grant.profile.id, url, reload: { hold: () => { holdReload = true }, requested: () => reloadRequested, release: () => releaseReload() }, connectAgain: async () => {
        const next = await connect(grant.credential); extraClients.push(next)
        await connectMcpWorkspace(next, 'File source replacement', false, workspace)
        return next
      }, reconnect: async () => {
        await client!.callTool({ name: 'browser_workspaces', arguments: { action: 'release-ownership', workspaceId: workspace.workspaceId } })
        await client!.close(); client = await connect(grant.credential)
        await connectMcpWorkspace(client, 'Reconnected file source', false, workspace)
        return client
      } })
    } finally {
      releaseReload()
      await electronApp.evaluate(() => { (globalThis as Scope).fileProbe?.release(); (globalThis as Scope).fileProbe?.restore() }).catch(() => undefined)
      for (const extra of extraClients) await extra.close().catch(() => undefined)
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


for (const phase of ['preparation', 'result', 'audit'] as const) {
  test(`cancellation preserves actual submission evidence during ${phase}`, async ({ evaluation, electronApp }) => {
    if (phase === 'audit') await evaluation.client.callTool({ name: 'browser_audit_receipts', arguments: { action: 'start' } })
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
    }, evaluation.source.tabId)).toMatchObject({ outcome: 'cancelled', dispatch: phase !== 'preparation' ? 'dispatched' : 'not-dispatched', effects: phase !== 'preparation' ? 'possible' : 'none' })
    expect(await electronApp.evaluate(() => (globalThis as Scope).fileProbe!.submissions.length)).toBe(phase !== 'preparation' ? 1 : 0)
  })
}

for (const change of ['unchanged', 'pause', 'navigation', 'revoke'] as const) {
  test(`settles publication and activity after late audit: ${change}`, async ({ evaluation, electronApp, appWindow }) => {
    const started = await evaluation.client.callTool({ name: 'browser_audit_receipts', arguments: { action: 'start' } }) as CallToolResult
    expect(started.isError).not.toBe(true)
    await electronApp.evaluate(() => { (globalThis as Scope).fileProbe!.mode = 'audit' })
    const pending = evaluation.client.callTool({ name: 'browser_evaluate_file', arguments: { tabId: evaluation.source.tabId, source: evaluation.source } }) as Promise<CallToolResult>
    await expect.poll(() => electronApp.evaluate(() => (globalThis as Scope).fileProbe!.held)).toBe(true)
    if (change === 'pause') await appWindow.evaluate(id => (window as unknown as { hronaut: HronautApi }).hronaut.setTabAgentPaused(id, true), evaluation.source.tabId)
    if (change === 'navigation') await electronApp.evaluate(async ({ webContents }, url) => {
      await webContents.getAllWebContents().find(page => page.getURL() === url)!.loadURL(`${url}?late=1`)
    }, evaluation.url)
    if (change === 'revoke') await appWindow.evaluate(id => (window as unknown as { hronautSettings: HronautSettingsApi }).hronautSettings.revokeMcpCapabilityProfile(id), evaluation.profileId)
    await electronApp.evaluate(() => (globalThis as Scope).fileProbe!.release())
    const result = await pending
    expect(result.structuredContent).toMatchObject({ status: change === 'unchanged' ? 'RETURNED' : 'OUTCOME_UNKNOWN', submitted: true, acknowledged: true })
    if (change !== 'unchanged') expect(result.structuredContent).not.toHaveProperty('value')
    expect(await electronApp.evaluate(() => (globalThis as Scope).fileProbe!.submissions.length)).toBe(1)
    const activity = await electronApp.evaluate(async ({ webContents }, tabId) => {
      const home = webContents.getAllWebContents().find(page => page.getURL().startsWith('hronaut://home'))!
      const status = await (await home.session.fetch('hronaut://home/api/status')).json() as { recentActivity: Array<{ toolName: string; tabId: string; result?: { outcome?: string; dispatch?: string; effects?: string } }> }
      return status.recentActivity.find(item => item.toolName === 'browser_evaluate_file' && item.tabId === tabId)?.result
    }, evaluation.source.tabId)
    expect(activity?.dispatch).toBe('dispatched')
    expect(activity?.outcome).toBe(change === 'unchanged' ? 'succeeded' : 'outcome-unknown')
  })
}

for (const failSave of [false, true]) {
  test(`settles reviewed file execution with review persistence failure=${failSave}`, async ({ evaluation, electronApp, appWindow }) => {
    const call = async (name: string, args: Record<string, unknown>) => await evaluation.client.callTool({ name, arguments: args }) as CallToolResult
    const args = { workspaceId: evaluation.source.workspaceId }
    expect((await call('browser_continuity', { ...args, action: 'checkpoint' })).isError).not.toBe(true)
    expect((await call('browser_audit_receipts', { action: 'start' })).isError).not.toBe(true)
    if (failSave) await writeFile(evaluation.source.path, failingCode)
    const source = failSave ? { ...evaluation.source, sha256: createHash('sha256').update(failingCode).digest('hex') } : evaluation.source
    const action = { ...args, tabId: source.tabId, source }
    const proposed = await call('browser_human_waiting', { ...args, action: 'request', runId: randomUUID(), decision: 'approve-action', timeoutMs: 60_000,
      review: { toolName: 'browser_evaluate_file', arguments: action, reversibility: 'unknown', representation: 'bounded-description', description: 'Run the synthetic exact source once' }
    })
    expect(proposed.isError, text(proposed)).not.toBe(true)
    await electronApp.evaluate(({ BrowserWindow }, id) => BrowserWindow.getAllWindows()[0]!.webContents.send('browser:edit-tab-group', id), evaluation.source.workspaceId)
    const editor = appWindow.getByRole('dialog', { name: 'Edit workspace', exact: true })
    await editor.locator('.workspace-activity-disclosure > summary').click()
    const continuity = editor.getByRole('region', { name: 'Workspace continuity', exact: true })
    await continuity.getByRole('button', { name: 'Read current state', exact: true }).click()
    await continuity.getByRole('checkbox').check()
    await continuity.getByRole('button', { name: 'Confirm reviewed state', exact: true }).click()
    const waiting = editor.getByRole('region', { name: 'Human decisions', exact: true })
    await waiting.getByRole('checkbox', { name: 'I reviewed this exact action and the bound workspace state.' }).check()
    await waiting.getByRole('checkbox', { name: 'I verified the signed-in account and visible target in the bound browser tab.' }).check()
    await waiting.getByRole('button', { name: 'Approve exact action', exact: true }).click()
    const listed = await call('browser_human_waiting', { ...args, action: 'list' })
    expect(listed.isError, text(listed)).not.toBe(true)
    const approved = (JSON.parse(text(listed)) as HumanWaitingRecord[])[0]!
    expect(approved.review?.status).toBe('APPROVED')
    await electronApp.evaluate((_electron, failSave) => { (globalThis as Scope).fileProbe!.failReviewSave = failSave }, failSave)
    const result = await call('browser_evaluate_file', { ...action, reviewId: approved.id, reviewRevision: approved.revision })
    expect(result.structuredContent).toMatchObject({ status: failSave ? 'OUTCOME_UNKNOWN' : 'RETURNED', submitted: true, acknowledged: true })
    const probe = await electronApp.evaluate(() => { const p = (globalThis as Scope).fileProbe!; return { submissions: p.submissions.length, failures: p.reviewSaveFailures } })
    expect(probe.submissions).toBe(1)
    expect(probe.failures).toBe(failSave ? 1 : 0)
    expect(text(result)).not.toContain('synthetic-review-persistence-secret')
    if (!failSave) {
      const finished = await call('browser_human_waiting', { ...args, action: 'list' })
      expect((JSON.parse(text(finished)) as HumanWaitingRecord[])[0]).toMatchObject({ state: 'ATTEMPTED', review: { status: 'ATTEMPTED' } })
    }
  })
}

test('rejects a reload started before admission that commits during source acquisition', async ({ evaluation, electronApp, appWindow }, info) => {
  evaluation.reload.hold()
  const originalListeners = await electronApp.evaluate(({ webContents }, url) => {
    const page = webContents.getAllWebContents().find(page => page.getURL() === url)!
    const listeners = page.listenerCount('did-navigate')
    ;(globalThis as typeof globalThis & { originalFileFrame?: unknown }).originalFileFrame = page.mainFrame
    void page.loadURL(url).catch(() => undefined)
    return listeners
  }, evaluation.url)
  await expect.poll(evaluation.reload.requested, { intervals: [10, 20, 50] }).toBe(true)
  const before = await appWindow.evaluate(async id => (await (window as unknown as { hronaut: HronautApi }).hronaut.getState()).tabs.find(tab => tab.id === id)!.navigationGeneration, evaluation.source.tabId)
  await electronApp.evaluate(() => { (globalThis as Scope).fileProbe!.holdOpen = true })
  const pending = evaluation.client.callTool({ name: 'browser_evaluate_file', arguments: { tabId: evaluation.source.tabId, source: evaluation.source } }) as Promise<CallToolResult>
  await expect.poll(() => electronApp.evaluate(() => (globalThis as Scope).fileProbe!.heldOpens), { intervals: [10, 20, 50] }).toBe(1)
  evaluation.reload.release()
  await expect.poll(() => electronApp.evaluate(async ({ webContents }, url) => webContents.getAllWebContents().find(page => page.getURL() === url)!.executeJavaScript('window.__documentVersion'), evaluation.url), { intervals: [10, 20, 50] }).toBe(2)
  const after = await appWindow.evaluate(async id => (await (window as unknown as { hronaut: HronautApi }).hronaut.getState()).tabs.find(tab => tab.id === id)!.navigationGeneration, evaluation.source.tabId)
  await electronApp.evaluate(() => { const probe = (globalThis as Scope).fileProbe!; probe.holdOpen = false; probe.release() })
  const result = await pending
  const observed = await electronApp.evaluate(async ({ webContents }, url) => {
    const page = webContents.getAllWebContents().find(page => page.getURL() === url)!
    return { listeners: page.listenerCount('did-navigate'), sameFrame: page.mainFrame === (globalThis as typeof globalThis & { originalFileFrame?: unknown }).originalFileFrame,
      submissions: (globalThis as Scope).fileProbe!.submissions.length, effects: await page.executeJavaScript('({version:window.__documentVersion,runs:window.__fileRuns||0})') }
  }, evaluation.url)
  await info.attach('already-started-reload', { body: JSON.stringify({ before, after, originalListeners, observed, result }), contentType: 'application/json' })
  expect(after).toBe(before)
  expect(observed.sameFrame).toBe(true)
  expect(result.structuredContent).toMatchObject({ status: 'NOT_DISPATCHED', submitted: false })
  expect(observed).toMatchObject({ listeners: originalListeners, submissions: 0, effects: { version: 2, runs: 0 } })
})

test('retains workspace mutation ownership after cancellation and transport termination until native settlement', async ({ evaluation, electronApp }) => {
  await electronApp.evaluate(() => { (globalThis as Scope).fileProbe!.mode = 'result' })
  const transport = evaluation.client.transport! as StreamableHTTPClientTransport
  const originalSend = transport.send.bind(transport)
  let requestId: string | number | undefined
  transport.send = async (message, options) => {
    if ('method' in message && message.method === 'tools/call' && 'id' in message && message.params?.name === 'browser_evaluate_file') requestId = message.id
    return originalSend(message, options)
  }
  const abort = new AbortController()
  const pending = evaluation.client.callTool({ name: 'browser_evaluate_file', arguments: { tabId: evaluation.source.tabId, source: evaluation.source } }, undefined, { signal: abort.signal }).catch(() => undefined)
  await expect.poll(() => electronApp.evaluate(() => (globalThis as Scope).fileProbe!.held)).toBe(true)
  await evaluation.client.notification({ method: 'notifications/cancelled', params: { requestId: requestId!, reason: 'Synthetic ownership cancellation' } })
  abort.abort(); await pending
  await expect.poll(() => electronApp.evaluate(async ({ webContents }, tabId) => {
    const home = webContents.getAllWebContents().find(page => page.getURL().startsWith('hronaut://home'))!
    const status = await (await home.session.fetch('hronaut://home/api/status')).json() as { recentActivity: Array<{ toolName: string; tabId: string; result?: { outcome?: string } }> }
    return status.recentActivity.find(item => item.toolName === 'browser_evaluate_file' && item.tabId === tabId)?.result?.outcome
  }, evaluation.source.tabId)).toBe('cancelled')
  await transport.terminateSession()
  const replacement = await evaluation.connectAgain()
  const ownership = await replacement.callTool({ name: 'browser_workspaces', arguments: { action: 'ownership-status', workspaceId: evaluation.source.workspaceId } }) as CallToolResult
  expect(JSON.parse(text(ownership)).writeLease).toMatchObject({ status: 'busy', holder: 'other' })
  const overlapping = await replacement.callTool({ name: 'browser_evaluate', arguments: { tabId: evaluation.source.tabId, script: 'globalThis.__overlapRuns = (globalThis.__overlapRuns || 0) + 1' } }) as CallToolResult
  expect(overlapping.isError).toBe(true)
  expect(await electronApp.evaluate(({ webContents }, url) => webContents.getAllWebContents().find(page => page.getURL() === url)!.executeJavaScript('globalThis.__overlapRuns || 0'), evaluation.url)).toBe(0)
  await electronApp.evaluate(() => (globalThis as Scope).fileProbe!.release())
  await expect.poll(async () => (await replacement.callTool({ name: 'browser_workspaces', arguments: { action: 'claim-ownership', workspaceId: evaluation.source.workspaceId } }) as CallToolResult).isError === true).toBe(false)
  expect(await electronApp.evaluate(() => (globalThis as Scope).fileProbe!.submissions.length)).toBe(1)
})

test('matches inline evaluation for the same captured source', async ({ evaluation, electronApp }) => {
  const request = { name: 'browser_evaluate_file', arguments: { tabId: evaluation.source.tabId, source: evaluation.source } }
  const fromFile = await evaluation.client.callTool(request) as CallToolResult
  await electronApp.evaluate(({ webContents }, url) => webContents.getAllWebContents().find(page => page.getURL() === url)!.executeJavaScript('delete globalThis.__fileRuns'), evaluation.url)
  const inline = await evaluation.client.callTool({ name: 'browser_evaluate', arguments: { tabId: evaluation.source.tabId, script: code } }) as CallToolResult
  expect(inline.isError, text(inline)).not.toBe(true)
  expect(fromFile.structuredContent?.value).toEqual(JSON.parse(text(inline)))
})

test('does not reopen or substitute a path replaced after capture', async ({ evaluation, electronApp }) => {
  await electronApp.evaluate(() => { (globalThis as Scope).fileProbe!.mode = 'preparation' })
  const pending = evaluation.client.callTool({ name: 'browser_evaluate_file', arguments: { tabId: evaluation.source.tabId, source: evaluation.source } }) as Promise<CallToolResult>
  await expect.poll(() => electronApp.evaluate(() => (globalThis as Scope).fileProbe!.held)).toBe(true)
  const opens = await electronApp.evaluate(() => (globalThis as Scope).fileProbe!.opens)
  await writeFile(`${evaluation.source.path}.replacement`, 'globalThis.__replacementRuns = 1; "replacement"')
  await rename(`${evaluation.source.path}.replacement`, evaluation.source.path)
  await electronApp.evaluate(() => (globalThis as Scope).fileProbe!.release())
  const result = await pending
  expect(result.structuredContent).toMatchObject({ status: 'RETURNED', value: { runs: 1, text: '🛰️\nexact' } })
  expect(await electronApp.evaluate(() => (globalThis as Scope).fileProbe!.opens)).toBe(opens)
  expect(await electronApp.evaluate(({ webContents }, url) => webContents.getAllWebContents().find(page => page.getURL() === url)!.executeJavaScript('globalThis.__replacementRuns || 0'), evaluation.url)).toBe(0)
})

test('retains acquisition capacity through held descriptor cleanup after deadlines', async ({ evaluation, electronApp }) => {
  await electronApp.evaluate(() => { (globalThis as Scope).fileProbe!.holdClose = true })
  const request = { name: 'browser_evaluate_file', arguments: { tabId: evaluation.source.tabId, source: evaluation.source } }
  for (let attempt = 1; attempt <= 2; attempt++) {
    const pending = evaluation.client.callTool(request) as Promise<CallToolResult>
    await expect.poll(() => electronApp.evaluate(() => (globalThis as Scope).fileProbe!.heldCloses)).toBe(attempt)
    expect((await pending).structuredContent).toMatchObject({ status: 'NOT_DISPATCHED', reason: 'DEADLINE', submitted: false })
  }
  const opens = await electronApp.evaluate(() => (globalThis as Scope).fileProbe!.opens)
  expect((await evaluation.client.callTool(request) as CallToolResult).structuredContent).toMatchObject({ status: 'NOT_DISPATCHED', reason: 'BUSY' })
  expect(await electronApp.evaluate(() => (globalThis as Scope).fileProbe!.opens)).toBe(opens)
  expect(await electronApp.evaluate(() => (globalThis as Scope).fileProbe!.submissions.length)).toBe(0)
  await electronApp.evaluate(() => { const p = (globalThis as Scope).fileProbe!; p.holdClose = false; p.release() })
  await expect.poll(() => electronApp.evaluate(() => (globalThis as Scope).fileProbe!.handles.every(handle => handle.fd === -1))).toBe(true)
  expect((await evaluation.client.callTool(request) as CallToolResult).structuredContent).toMatchObject({ status: 'RETURNED', value: { runs: 1 } })
})
