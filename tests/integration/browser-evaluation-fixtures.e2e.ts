import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import {
  buildBrowserEvaluationReport,
  type BrowserEvaluationObservation
} from '../../scripts/browser-evaluation-report.js'
import { readBrowserPostcondition } from '../../src/main/mcp/post-write-browser-read.js'
import type { HumanWaitingRecord } from '../../src/shared/human-waiting.js'
import { closeFixtureServer, expect, test } from './fixtures.js'

test('runs pinned local browser failure scenarios and exports privacy-safe evidence', async ({ electronApp, mcpPort, mcpToken }, testInfo) => {
  let authenticated = true
  let flakyReads = 0
  let commits = 0
  const fixture = createServer((request, response) => {
    if (request.method === 'POST' && request.url === '/commit') {
      commits += 1
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ committed: true }))
      return
    }
    if (request.url === '/state') {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ commits }))
      return
    }
    if (request.url === '/session') {
      response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
      response.end(JSON.stringify({ authenticated }))
      return
    }
    if (request.url === '/flaky') {
      flakyReads += 1
      response.writeHead(flakyReads === 1 ? 503 : 200, { 'content-type': 'text/html', 'cache-control': 'no-store' })
      response.end(flakyReads === 1
        ? '<!doctype html><title>Temporary failure</title><main>Read unavailable</main>'
        : '<!doctype html><title>Recovered read</title><main>Fixture ready</main>')
      return
    }
    response.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' })
    if (request.url === '/auth') {
      response.end(`<!doctype html><title>Authentication fixture</title><div id="account">Synthetic account</div><div id="state">Ready</div>
        <script>setInterval(async()=>{try{const state=await fetch('/session',{cache:'no-store'}).then(r=>r.json());if(!state.authenticated)location.replace('/signed-out')}catch{}},50)</script>`)
    } else if (request.url === '/signed-out') {
      response.end('<!doctype html><title>Signed out</title><div id="account">Signed out</div><div id="state">Authentication required</div>')
    } else if (request.url === '/ambiguous') {
      response.end(`<!doctype html><title>Ambiguous write fixture</title><div id="account">Synthetic account</div><div id="state">Pending</div>
        <button id="commit" onclick="fetch('/commit',{method:'POST'}).then(()=>location.assign('/signed-out'))">Commit once</button>`)
    } else if (request.url === '/changed') {
      response.end('<!doctype html><title>Changed context</title><main>Changed fixture context</main>')
    } else {
      response.end('<!doctype html><title>Stable fixture</title><div id="account">Synthetic account</div><div id="state">Ready</div><button id="noop">Continue</button>')
    }
  })
  await new Promise<void>(resolveListen => fixture.listen(0, '127.0.0.1', resolveListen))
  const address = fixture.address()
  if (!address || typeof address === 'string') throw new Error('Missing browser evaluation fixture address')
  const origin = `http://127.0.0.1:${address.port}`
  const clients: Client[] = []
  const connect = async () => {
    const client = new Client({ name: 'hronaut-browser-evaluation', version: '1.0.0' })
    clients.push(client)
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort}/mcp`), {
      requestInit: { headers: { authorization: `Bearer ${mcpToken}` } }
    }))
    return client
  }
  const call = (client: Client, name: string, args: Record<string, unknown>) => client.callTool({ name, arguments: args }) as Promise<CallToolResult>
  const decode = <T>(result: CallToolResult): T => {
    const text = result.content.filter(part => part.type === 'text').map(part => part.text).join('\n')
    expect(result.isError, text).not.toBe(true)
    return JSON.parse(text) as T
  }
  const structured = <T>(result: CallToolResult): T => {
    expect(result.isError).not.toBe(true)
    expect(result.structuredContent).toBeDefined()
    return result.structuredContent as T
  }
  const snapshot = async (client: Client, workspaceId: string, tabId: string) => structured<{ text: string }>(
    await call(client, 'browser_snapshot', { workspaceId, tabId })
  )
  const postconditionEvidence = (path: string) => readBrowserPostcondition({
    condition: {
      expectedOrigin: origin,
      accountSelector: '#account', expectedAccount: 'Synthetic account',
      stateSelector: '#state', expectedText: 'Saved'
    },
    validateCurrent: () => undefined,
    evaluate: script => electronApp.evaluate(async ({ webContents }, input) => {
      const page = webContents.getAllWebContents().find(contents => contents.getURL().startsWith(input.url))
      if (!page) throw new Error('Missing evaluation fixture page')
      return page.executeJavaScriptInIsolatedWorld(1012, [{ code: input.script }])
    }, { url: `${origin}${path}`, script })
  })
  try {
    await expect.poll(async () => { try { return (await fetch(`http://127.0.0.1:${mcpPort}/healthz`)).ok } catch { return false } }).toBe(true)
    let client = await connect()
    const workspace = decode<{ id: string; resumeKey: string }>(await call(client, 'browser_workspaces', {
      action: 'create', storage: 'scratch', name: 'Synthetic browser evaluation'
    }))
    const tab = decode<{ activeTabId: string }>(await call(client, 'browser_new_tab', { workspaceId: workspace.id, url: `${origin}/stable` }))
    const tabId = tab.activeTabId

    const navigationBaseline = structured<{ baselineId: string }>(await call(client, 'browser_snapshot', {
      workspaceId: workspace.id, tabId, action: 'set-baseline'
    }))
    decode(await call(client, 'browser_navigate', { workspaceId: workspace.id, tabId, url: `${origin}/changed` }))
    const navigationDelta = structured<{ status: string; invalidationReason: string }>(await call(client, 'browser_snapshot', {
      workspaceId: workspace.id, tabId, action: 'delta', baselineId: navigationBaseline.baselineId
    }))
    expect(navigationDelta).toMatchObject({ status: 'invalidated', invalidationReason: 'navigation' })

    decode(await call(client, 'browser_navigate', { workspaceId: workspace.id, tabId, url: `${origin}/stable` }))
    const reconnectBaseline = structured<{ baselineId: string }>(await call(client, 'browser_snapshot', {
      workspaceId: workspace.id, tabId, action: 'set-baseline'
    }))
    await client.close()
    client = await connect()
    decode(await call(client, 'browser_workspaces', { action: 'resume', workspaceId: workspace.id, resumeKey: workspace.resumeKey }))
    const reconnectDelta = structured<{ status: string; invalidationReason: string }>(await call(client, 'browser_snapshot', {
      workspaceId: workspace.id, tabId, action: 'delta', baselineId: reconnectBaseline.baselineId
    }))
    expect(reconnectDelta).toMatchObject({ status: 'invalidated', invalidationReason: 'workspace-control' })

    decode(await call(client, 'browser_navigate', { workspaceId: workspace.id, tabId, url: `${origin}/auth` }))
    const authBaseline = structured<{ baselineId: string }>(await call(client, 'browser_snapshot', {
      workspaceId: workspace.id, tabId, action: 'set-baseline'
    }))
    authenticated = false
    await expect.poll(() => electronApp.evaluate(({ webContents }, expected) => (
      webContents.getAllWebContents().some(contents => contents.getURL() === expected)
    ), `${origin}/signed-out`)).toBe(true)
    const authDelta = structured<{ status: string; invalidationReason: string }>(await call(client, 'browser_snapshot', {
      workspaceId: workspace.id, tabId, action: 'delta', baselineId: authBaseline.baselineId
    }))
    expect(authDelta).toMatchObject({ status: 'invalidated', invalidationReason: 'navigation' })
    expect(await postconditionEvidence('/signed-out')).toBe('context-changed')

    authenticated = true
    decode(await call(client, 'browser_navigate', { workspaceId: workspace.id, tabId, url: `${origin}/stable` }))
    const waiting = decode<HumanWaitingRecord>(await call(client, 'browser_human_waiting', {
      workspaceId: workspace.id, action: 'request', runId: randomUUID(), decision: 'review-page',
      owner: 'Synthetic operator', fallbackOwner: 'Synthetic fallback', timeoutMs: 1_000
    }))
    const blocked = await call(client, 'browser_click', { workspaceId: workspace.id, tabId, selector: '#noop' })
    expect(blocked.isError).toBe(true)
    await expect.poll(async () => decode<HumanWaitingRecord[]>(await call(client, 'browser_human_waiting', {
      workspaceId: workspace.id, action: 'list'
    })).find(record => record.id === waiting.id)?.state).toBe('EXPIRED')

    const cancelledRun = decode<{ id: string; revision: string }>(await call(client, 'browser_task_runs', {
      workspaceId: workspace.id, action: 'start', deadlineMs: 60_000, heartbeatTimeoutMs: 10_000
    }))
    expect(decode<{ state: string; terminalReason: string; effects: string }>(await call(client, 'browser_task_runs', {
      workspaceId: workspace.id,
      action: 'complete',
      taskRunId: cancelledRun.id,
      revision: cancelledRun.revision,
      outcome: 'CANCELLED'
    }))).toMatchObject({
      state: 'CANCELLED', terminalReason: 'CALLER_REPORTED_CANCELLED', effects: 'not-established'
    })

    const readWorkspace = decode<{ id: string }>(await call(client, 'browser_workspaces', {
      action: 'create', storage: 'scratch', name: 'Synthetic response evaluation'
    }))
    const readTab = decode<{ activeTabId: string }>(await call(client, 'browser_new_tab', {
      workspaceId: readWorkspace.id, url: `${origin}/flaky`
    }))
    const readTabId = readTab.activeTabId
    expect((await snapshot(client, readWorkspace.id, readTabId)).text).toContain('Read unavailable')
    decode(await call(client, 'browser_history', { workspaceId: readWorkspace.id, tabId: readTabId, action: 'reload' }))
    await expect.poll(async () => (await snapshot(client, readWorkspace.id, readTabId)).text).toContain('Fixture ready')
    expect(flakyReads).toBe(2)

    decode(await call(client, 'browser_navigate', { workspaceId: readWorkspace.id, tabId: readTabId, url: `${origin}/ambiguous` }))
    const audit = decode<{ id: string }>(await call(client, 'browser_audit_receipts', { workspaceId: readWorkspace.id, action: 'start' }))
    const write = decode<{ postWriteVerification: { status: string; reason: string } }>(await call(client, 'browser_click', {
      workspaceId: readWorkspace.id,
      tabId: readTabId,
      selector: '#commit',
      postcondition: {
        expectedOrigin: origin,
        accountSelector: '#account', expectedAccount: 'Synthetic account',
        stateSelector: '#state', expectedText: 'Saved',
        timeoutMs: 2_000, maxAttempts: 5, initialDelayMs: 50
      }
    }))
    expect(write.postWriteVerification.status).toBe('unknown')
    expect(['context-changed', 'read-unavailable']).toContain(write.postWriteVerification.reason)
    const authoritativeState = await fetch(`${origin}/state`).then(response => response.json()) as { commits: number }
    expect(authoritativeState).toEqual({ commits: 1 })
    decode(await call(client, 'browser_audit_receipts', { workspaceId: readWorkspace.id, action: 'stop' }))
    const receipts = decode<{ receipts: Array<{ event: { phase: string; status?: string; reason?: string } }> }>(await call(client, 'browser_audit_receipts', {
      workspaceId: readWorkspace.id, action: 'read', runId: audit.id
    }))
    expect(receipts.receipts.map(receipt => receipt.event)).toEqual(expect.arrayContaining([
      expect.objectContaining({ phase: 'outcome', status: 'succeeded' }),
      expect.objectContaining({ phase: 'verification', status: 'unknown' })
    ]))
    const terminalVerification = receipts.receipts.find(receipt => (
      receipt.event.phase === 'verification'
      && receipt.event.status === 'unknown'
      && ['context-changed', 'read-unavailable'].includes(receipt.event.reason ?? '')
    ))
    expect(terminalVerification).toBeDefined()

    const observations: BrowserEvaluationObservation[] = [
      { scenarioId: 'navigation-drift', outcome: 'invalidated', contextStatus: 'navigation-changed', approvalStatus: 'not-required', toolResult: 'invalidated', dispatchStatus: 'not-dispatched', transportStatus: 'not-started', postconditionStatus: 'not-established', authoritativeReadback: 'not-performed', retryAllowed: false },
      { scenarioId: 'reconnect-drift', outcome: 'invalidated', contextStatus: 'control-changed', approvalStatus: 'not-required', toolResult: 'invalidated', dispatchStatus: 'not-dispatched', transportStatus: 'not-started', postconditionStatus: 'not-established', authoritativeReadback: 'not-performed', retryAllowed: false },
      { scenarioId: 'expired-authentication', outcome: 'reconciliation_required', contextStatus: 'signed-out', approvalStatus: 'not-required', toolResult: 'invalidated', dispatchStatus: 'not-dispatched', transportStatus: 'not-started', postconditionStatus: 'context-changed', authoritativeReadback: 'unavailable', retryAllowed: false },
      { scenarioId: 'blocked-human-takeover', outcome: 'blocked', contextStatus: 'matches', approvalStatus: 'expired', toolResult: 'blocked', dispatchStatus: 'not-dispatched', transportStatus: 'not-started', postconditionStatus: 'not-established', authoritativeReadback: 'not-performed', retryAllowed: false },
      { scenarioId: 'scheduler-cancel-before-dispatch', outcome: 'cancelled', contextStatus: 'matches', approvalStatus: 'not-required', toolResult: 'not-run', dispatchStatus: 'not-dispatched', transportStatus: 'not-started', postconditionStatus: 'not-established', authoritativeReadback: 'not-performed', retryAllowed: false },
      { scenarioId: 'flaky-read-response', outcome: 'recovered', contextStatus: 'matches', approvalStatus: 'not-required', toolResult: 'accepted', dispatchStatus: 'not-dispatched', transportStatus: 'succeeded', postconditionStatus: 'verified', authoritativeReadback: 'verified', retryAllowed: true },
      { scenarioId: 'ambiguous-write-response', outcome: 'reconciled', contextStatus: 'signed-out', approvalStatus: 'not-required', toolResult: 'unknown', dispatchStatus: 'dispatched-once', transportStatus: 'succeeded', postconditionStatus: 'not-verified', authoritativeReadback: 'verified', retryAllowed: false }
    ]
    const packageJson = JSON.parse(await readFile('package.json', 'utf8')) as { version: string }
    const report = buildBrowserEvaluationReport(packageJson.version, observations)
    const exported = `${JSON.stringify(report, null, 2)}\n`
    const output = process.env.HRONAUT_BROWSER_EVALUATION_OUTPUT
      ? resolve(process.env.HRONAUT_BROWSER_EVALUATION_OUTPUT)
      : testInfo.outputPath('browser-evaluation-report.json')
    await mkdir(dirname(output), { recursive: true })
    await writeFile(output, exported, { mode: 0o644 })
    await testInfo.attach('browser-evaluation-report', { body: exported, contentType: 'application/json' })
    for (const privateValue of [origin, workspace.id, readWorkspace.id, workspace.resumeKey, mcpToken, '#account', '#state', '#commit', 'Synthetic account', 'Signed out']) {
      expect(exported).not.toContain(privateValue)
    }
  } finally {
    await Promise.allSettled(clients.map(client => client.close()))
    await closeFixtureServer(fixture)
  }
})
