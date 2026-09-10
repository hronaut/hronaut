import { createServer, type ServerResponse } from 'node:http'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { AuditReceipt } from '../../src/main/mcp/audit-receipt-store.js'
import type { BrowserNetworkRequest, BrowserState, BrowserTabState, HronautMcpApi } from '../../src/shared/types.js'
import { closeFixtureServer, expect, test } from './fixtures.js'

test('fences delayed reads, writes, and redirects across a real pause/resume', async ({ appWindow, mcpPort, mcpToken }) => {
  const held = new Map<string, ServerResponse>()
  let readStarted = false
  const fixture = createServer((request, response) => {
    const path = request.url ?? '/'
    if (path.startsWith('/hold-')) { held.set(path, response); return }
    if (path === '/read-started') { readStarted = true; response.end('ok'); return }
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end('<!doctype html><title>Handoff fixture</title><main>Waiting</main>')
  })
  await new Promise<void>(resolve => fixture.listen(0, '127.0.0.1', resolve))
  const address = fixture.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture port')
  const client = new Client({ name: 'stale-result-test', version: '1' })
  const call = async (name: string, args: Record<string, unknown>) => await client.callTool({ name, arguments: args }) as CallToolResult
  const parse = <T>(result: CallToolResult): T => {
    expect(result.isError).not.toBe(true)
    return JSON.parse(result.content.filter(part => part.type === 'text').map(part => part.text).join('\n')) as T
  }
  const pauseAndResume = async (settling = true) => {
    await appWindow.evaluate(async () => {
      const api = (window as unknown as { hronautMcp: HronautMcpApi }).hronautMcp
      await api.setPaused(true)
    })
    await expect(appWindow.getByRole('button', {
      name: settling ? 'Agents paused · 1 settling' : 'Agents paused',
      exact: true
    })).toBeVisible()
    await appWindow.evaluate(async () => {
      const api = (window as unknown as { hronautMcp: HronautMcpApi }).hronautMcp
      await api.setPaused(false)
    })
  }
  try {
    await expect.poll(async () => {
      try { return (await fetch(`http://127.0.0.1:${mcpPort}/healthz`)).ok } catch { return false }
    }).toBe(true)
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort}/mcp`), {
      requestInit: { headers: { authorization: `Bearer ${mcpToken}` } }
    }))
    const workspace = parse<{ id: string }>(await call('browser_workspaces', { action: 'create', storage: 'scratch', name: 'Handoff fixture' }))
    const state = parse<BrowserState>(await call('browser_new_tab', { workspaceId: workspace.id, url: `http://127.0.0.1:${address.port}` }))
    const audit = parse<{ id: string }>(await call('browser_audit_receipts', { workspaceId: workspace.id, action: 'start' }))
    const args = { workspaceId: workspace.id, tabId: state.activeTabId! }
    expect((await call('browser_evaluate', { ...args, script: `(() => {
      const getter = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'innerText').get;
      Object.defineProperty(document.body, 'innerText', { get() { void fetch('/read-started'); return getter.call(this); } });
      void fetch('/hold-read').then(() => { document.querySelector('main').textContent = 'late-read-canary'; });
      return 'armed';
    })()` })).isError).not.toBe(true)
    const read = call('browser_wait', { ...args, text: 'late-read-canary', timeoutMs: 10000 })
    void read.catch(() => undefined)
    await expect.poll(() => readStarted && held.has('/hold-read')).toBe(true)
    const beforeHandoffNetwork = parse<BrowserNetworkRequest[]>(await call('browser_network', args))
    const crossedRequest = beforeHandoffNetwork.find(request => request.url.endsWith('/hold-read'))
    expect(crossedRequest).toBeDefined()
    await pauseAndResume()
    held.get('/hold-read')!.end('release')
    const readResult = await read
    expect(readResult.isError).toBe(true)
    expect(readResult.structuredContent).toMatchObject({ status: 'STALE_OBSERVATION', retrySafe: false })
    expect(JSON.stringify(readResult)).not.toContain('late-read-canary')
    const afterHandoffNetwork = parse<BrowserNetworkRequest[]>(await call('browser_network', args))
    expect(afterHandoffNetwork.some(request => request.url.endsWith('/hold-read'))).toBe(false)
    const staleRequestDetails = await call('browser_network_request', { ...args, requestId: crossedRequest!.id })
    expect(staleRequestDetails.isError).toBe(true)
    expect(JSON.stringify(staleRequestDetails)).toContain('Call browser_network again for current request IDs')

    const redirect = call('browser_navigate', {
      ...args,
      url: `http://127.0.0.1:${address.port}/hold-redirect`
    })
    void redirect.catch(() => undefined)
    await expect.poll(() => held.has('/hold-redirect')).toBe(true)
    await pauseAndResume()
    held.get('/hold-redirect')!.writeHead(302, { location: '/redirected' })
    held.get('/hold-redirect')!.end()
    const redirectResult = await redirect
    expect(redirectResult.isError).toBe(true)
    expect(redirectResult.structuredContent).toMatchObject({ status: 'OUTCOME_UNKNOWN', retrySafe: false })
    await expect.poll(async () => {
      const current = parse<BrowserTabState[]>(await call('browser_tabs', { workspaceId: workspace.id }))
      return current.find(tab => tab.id === args.tabId)?.url
    }).toBe(`http://127.0.0.1:${address.port}/redirected`)
    const afterRedirectNetwork = parse<BrowserNetworkRequest[]>(await call('browser_network', args))
    expect(afterRedirectNetwork.some(request => request.url.includes('/hold-redirect'))).toBe(false)
    expect(afterRedirectNetwork.some(request => request.url.includes('/redirected'))).toBe(false)

    expect((await call('browser_dom_changes', { ...args, action: 'start' })).isError).not.toBe(true)
    expect((await call('browser_evaluate', {
      ...args,
      script: "void fetch('/hold-dom').then(() => { const node = document.createElement('aside'); node.dataset.lateDom = 'true'; document.body.append(node); }); 'armed'"
    })).isError).not.toBe(true)
    await expect.poll(() => held.has('/hold-dom')).toBe(true)
    await pauseAndResume(false)
    held.get('/hold-dom')!.end('release')
    expect((await call('browser_wait', {
      ...args,
      selector: '[data-late-dom="true"]',
      state: 'attached',
      timeoutMs: 5_000
    })).isError).not.toBe(true)
    const afterHandoffDom = parse<{ active: boolean; changeCount: number }>(await call('browser_dom_changes', {
      ...args,
      action: 'get'
    }))
    expect(afterHandoffDom).toMatchObject({ active: false, changeCount: 0 })

    const armDownload = await call('browser_evaluate', {
      ...args,
      script: `setTimeout(() => { location.href = ${JSON.stringify(`http://127.0.0.1:${address.port}/hold-download`)} }, 0); 'armed'`
    })
    expect(armDownload.isError).not.toBe(true)
    await expect.poll(() => held.has('/hold-download')).toBe(true)
    await pauseAndResume(false)
    held.get('/hold-download')!.writeHead(200, {
      'content-type': 'text/plain',
      'content-disposition': 'attachment; filename="stale-generation.txt"'
    })
    held.get('/hold-download')!.end('download completed after handoff')
    await expect.poll(() => appWindow.evaluate('window.hronautDownloads.list()'))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ filename: 'stale-generation.txt', state: 'completed' })
      ]))
    const workspaceDownloads = parse<Array<{ filename: string }>>(await call('browser_downloads', {
      workspaceId: workspace.id
    }))
    expect(workspaceDownloads.some(download => download.filename === 'stale-generation.txt')).toBe(false)

    const write = call('browser_evaluate', { ...args, script: "fetch('/hold-write').then(() => { document.body.dataset.effect = 'applied'; return 'late-write-canary'; })" })
    void write.catch(() => undefined)
    await expect.poll(() => held.has('/hold-write')).toBe(true)
    await pauseAndResume()
    held.get('/hold-write')!.end('release')
    const writeResult = await write
    expect(writeResult.isError).toBe(true)
    expect(writeResult.structuredContent).toMatchObject({ status: 'OUTCOME_UNKNOWN', retrySafe: false })
    expect(JSON.stringify(writeResult)).not.toContain('late-write-canary')
    const report = parse<{ receipts: AuditReceipt[] }>(await call('browser_audit_receipts', {
      workspaceId: workspace.id, action: 'read', runId: audit.id
    }))
    const outcomes = report.receipts
      .map(receipt => receipt.event)
      .filter((event): event is Extract<AuditReceipt['event'], { phase: 'outcome' }> => event.phase === 'outcome')
    expect(outcomes).toEqual(expect.arrayContaining([
      expect.objectContaining({ status: 'succeeded', effects: 'possible' }),
      expect.objectContaining({ status: 'stale-observation', effects: 'none' }),
      expect.objectContaining({ status: 'outcome-unknown', effects: 'possible' })
    ]))
    const initialGeneration = outcomes.find(event => event.status === 'succeeded')?.state?.observationGeneration
    const staleGeneration = outcomes.find(event => event.status === 'stale-observation')?.state?.observationGeneration
    const unknownGenerations = outcomes
      .filter(event => event.status === 'outcome-unknown')
      .map(event => event.state?.observationGeneration)
    expect(initialGeneration).toBe(0)
    expect(staleGeneration).toBe(1)
    expect(unknownGenerations).toEqual([2, 5])
    expect(JSON.stringify(report)).not.toContain('late-write-canary')
    expect(JSON.stringify(report)).not.toContain('late-read-canary')
    const fresh = await call('browser_evaluate', { ...args, script: 'document.body.dataset.effect' })
    expect(fresh.isError).not.toBe(true)
    expect(fresh.content).toContainEqual({ type: 'text', text: 'applied' })
    await expect.poll(() => appWindow.evaluate(async () => (
      (window as unknown as { hronautMcp: HronautMcpApi }).hronautMcp.getState()
    ))).toMatchObject({ activeCommands: 0, paused: false })

    const disconnected = call('browser_evaluate', { ...args, script: "fetch('/hold-disconnect').then(() => 'finished')" })
    void disconnected.catch(() => undefined)
    await expect.poll(() => held.has('/hold-disconnect')).toBe(true)
    await client.close()
    await appWindow.evaluate(async () => {
      await (window as unknown as { hronautMcp: HronautMcpApi }).hronautMcp.setPaused(true)
    })
    await expect(appWindow.getByRole('button', { name: 'Agents paused · 1 settling' })).toBeVisible()
    const pausedResponse = await fetch(`http://127.0.0.1:${mcpPort}/mcp`, {
      headers: { authorization: `Bearer ${mcpToken}` }
    })
    expect(pausedResponse.status).toBe(503)
    expect(await pausedResponse.json()).toMatchObject({ handoff: {
      state: 'PAUSED_WITH_ACTIVE_COMMANDS', activeCommands: 1, priorActionOutcome: 'NOT_ESTABLISHED'
    } })
    held.get('/hold-disconnect')!.end('release')
    await expect(appWindow.getByRole('button', { name: 'Agents paused', exact: true })).toBeVisible()
    await expect.poll(() => appWindow.evaluate(async () => (
      (window as unknown as { hronautMcp: HronautMcpApi }).hronautMcp.getState()
    ))).toMatchObject({ activeCommands: 0, paused: true })
  } finally {
    for (const response of held.values()) response.end()
    await client.close()
    await closeFixtureServer(fixture)
  }
})
