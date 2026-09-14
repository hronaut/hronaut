import { createServer } from 'node:http'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { BrowserState, HronautApi } from '../../src/shared/types.js'
import { closeFixtureServer, expect, test } from './fixtures.js'

test('reports snapshot and search source limits through MCP without exposing form values or foreign tabs', async ({ appWindow, electronApp, mcpPort, mcpToken }) => {
  const fixture = createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    const body = request.url?.startsWith('/caps')
      ? '<h1>Heading</h1>'.repeat(81)
      : request.url?.startsWith('/long')
        ? 'word '.repeat(25000) + 'omitted-tail-canary'
        : request.url?.startsWith('/delta')
          ? '<h1>Inbox</h1><h2>Old section</h2><button>Compose</button><p>First message</p>'
          : 'Short visible page'
    response.end(`<!doctype html><title>Snapshot bounds</title><input value="form-value-canary"><main>${body}</main>`)
  })
  await new Promise<void>(resolve => fixture.listen(0, '127.0.0.1', resolve))
  const address = fixture.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture port')
  const origin = `http://127.0.0.1:${address.port}`
  const clients: Client[] = []
  const connect = async () => {
    const client = new Client({ name: 'snapshot-bounds-test', version: '1' })
    clients.push(client)
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort}/mcp`), {
      requestInit: { headers: { authorization: `Bearer ${mcpToken}` } }
    }))
    return client
  }
  const call = async (client: Client, name: string, args: Record<string, unknown>) => await client.callTool({ name, arguments: args }) as CallToolResult
  const parse = <T>(result: CallToolResult): T => {
    expect(result.isError).not.toBe(true)
    return JSON.parse(result.content.filter(part => part.type === 'text').map(part => part.text).join('\n')) as T
  }
  try {
    await expect.poll(async () => {
      try { return (await fetch(`http://127.0.0.1:${mcpPort}/healthz`)).ok } catch { return false }
    }).toBe(true)
    const client = await connect()
    const workspace = parse<{ id: string; resumeKey: string }>(await call(client, 'browser_workspaces', { action: 'create', name: 'Snapshot bounds', storage: 'scratch' }))
    let longTabId = ''
    for (const long of [false, true]) {
      const state = parse<BrowserState>(await call(client, 'browser_new_tab', { workspaceId: workspace.id, url: `${origin}/${long ? 'long' : 'short'}?token=url-secret-canary` }))
      const tabId = state.activeTabId!
      if (long) longTabId = tabId
      const result = await call(client, 'browser_snapshot', { workspaceId: workspace.id, tabId, maxChars: 1000 })
      expect(result.isError).not.toBe(true)
      expect(result.structuredContent).toMatchObject({ truncated: long, maxChars: 1000, returnedChars: expect.any(Number) })
      const metadata = result.structuredContent as { text: string; returnedChars: number }
      expect(metadata.returnedChars).toBe(metadata.text.length)
      expect(metadata.returnedChars).toBeLessThanOrEqual(1000)
      expect(result.content).toContainEqual({ type: 'text', text: metadata.text })
      for (const secret of ['form-value-canary', 'url-secret-canary', 'omitted-tail-canary']) expect(JSON.stringify(result)).not.toContain(secret)
    }
    const search = parse<{ truncated: boolean; sourceSnapshot: { truncated: boolean; maxChars: number; returnedChars: number } }>(await call(client, 'browser_find', {
      workspaceId: workspace.id, tabId: longTabId, query: 'omitted-tail-canary'
    }))
    expect(search.truncated).toBe(false)
    expect(search.sourceSnapshot).toMatchObject({ truncated: true, maxChars: 100000, returnedChars: 100000 })
    const capped = parse<BrowserState>(await call(client, 'browser_new_tab', { workspaceId: workspace.id, url: `${origin}/caps` }))
    const copied = await appWindow.evaluate(tabId => (window as unknown as { hronaut: HronautApi }).hronaut.copySnapshot(tabId), capped.activeTabId!)
    expect(copied.characters).toBeLessThan(30000)
    expect(copied.truncated).toBe(true)

    const deltaTab = parse<BrowserState>(await call(client, 'browser_new_tab', { workspaceId: workspace.id, url: `${origin}/delta` }))
    const deltaTabId = deltaTab.activeTabId!
    const baselineResult = await call(client, 'browser_snapshot', {
      workspaceId: workspace.id, tabId: deltaTabId, action: 'set-baseline', maxChars: 5_000
    })
    expect(baselineResult.isError).not.toBe(true)
    const baseline = baselineResult.structuredContent as { baselineId: string; status: string; text: string }
    expect(baseline).toMatchObject({ baselineId: expect.any(String), status: 'baseline' })
    expect(baseline.text).toContain('First message')
    expect(JSON.stringify(baselineResult)).not.toContain('form-value-canary')

    const unchangedResult = await call(client, 'browser_snapshot', {
      workspaceId: workspace.id, tabId: deltaTabId, action: 'delta', baselineId: baseline.baselineId,
      maxOutputChars: 1_000, advanceBaseline: false
    })
    const unchanged = unchangedResult.structuredContent as { status: string; changes: unknown[] }
    expect(unchanged).toMatchObject({ status: 'unchanged', changes: [], truncated: false })
    expect(unchangedResult.content[0]?.type === 'text' ? unchangedResult.content[0].text.length : Infinity).toBeLessThanOrEqual(1_000)
    expect(JSON.stringify(unchangedResult)).not.toContain('form-value-canary')

    await electronApp.evaluate(({ webContents }, origin) => {
      const page = webContents.getAllWebContents().find(candidate => candidate.getURL().startsWith(`${origin}/delta`))
      if (!page) throw new Error('Missing delta fixture page')
      page.sendInputEvent({ type: 'keyDown', keyCode: 'A' })
      page.sendInputEvent({ type: 'keyUp', keyCode: 'A' })
    }, origin)
    const humanDrift = (await call(client, 'browser_snapshot', {
      workspaceId: workspace.id, tabId: deltaTabId, action: 'delta', baselineId: baseline.baselineId
    })).structuredContent as { status: string; invalidationReason: string }
    expect(humanDrift).toMatchObject({ status: 'invalidated', invalidationReason: 'human-input' })
    const activeBaselineResult = await call(client, 'browser_snapshot', {
      workspaceId: workspace.id, tabId: deltaTabId, action: 'set-baseline', maxChars: 5_000
    })
    const activeBaseline = activeBaselineResult.structuredContent as { baselineId: string }

    expect((await call(client, 'browser_evaluate', {
      workspaceId: workspace.id,
      tabId: deltaTabId,
      script: `document.title = 'Changed'; document.querySelector('h1').textContent = 'Updates'; document.querySelector('h2').remove(); document.querySelector('button').textContent = 'Open'; document.querySelector('main').append(Object.assign(document.createElement('h3'), { textContent: 'New section' }))`
    })).isError).not.toBe(true)
    const changedResult = await call(client, 'browser_snapshot', {
      workspaceId: workspace.id, tabId: deltaTabId, action: 'delta', baselineId: activeBaseline.baselineId,
      maxOutputChars: 4_000, advanceBaseline: false
    })
    const changed = changedResult.structuredContent as {
      status: string
      changeCounts: { added: number; updated: number }
      changes: Array<{ kind: string; key: string }>
      baselineAdvanced: boolean
    }
    expect(changed).toMatchObject({ status: 'changed', baselineAdvanced: false })
    expect(changed.changeCounts.added).toBeGreaterThanOrEqual(1)
    expect(changed.changeCounts.updated).toBeGreaterThanOrEqual(3)
    expect(changed.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'updated', key: 'title' }),
      expect.objectContaining({ kind: 'updated', key: 'control:e2' }),
      expect.objectContaining({ kind: 'added', key: 'h3:1' }),
      expect.objectContaining({ kind: 'removed', key: 'h2:1' })
    ]))
    expect(JSON.stringify(changedResult)).not.toContain('form-value-canary')

    expect((await call(client, 'browser_evaluate', {
      workspaceId: workspace.id,
      tabId: deltaTabId,
      script: `document.querySelector('main').prepend(...Array.from({ length: 70 }, (_, index) => Object.assign(document.createElement('h3'), { textContent: 'Added heading ' + index })))`
    })).isError).not.toBe(true)
    const truncatedResult = await call(client, 'browser_snapshot', {
      workspaceId: workspace.id, tabId: deltaTabId, action: 'delta', baselineId: activeBaseline.baselineId,
      maxOutputChars: 1_000
    })
    const truncated = truncatedResult.structuredContent as { status: string; truncated: boolean; baselineAdvanced: boolean; returnedChanges: number; changeCounts: Record<string, number> }
    expect(truncated).toMatchObject({ status: 'changed', truncated: true, baselineAdvanced: false })
    expect(truncated.returnedChanges).toBeLessThan(Object.values(truncated.changeCounts).reduce((sum, count) => sum + count, 0))
    expect(truncatedResult.content[0]?.type === 'text' ? truncatedResult.content[0].text.length : Infinity).toBeLessThanOrEqual(1_000)

    const advanced = (await call(client, 'browser_snapshot', {
      workspaceId: workspace.id, tabId: deltaTabId, action: 'delta', baselineId: activeBaseline.baselineId,
      maxOutputChars: 50_000
    })).structuredContent as { status: string; truncated: boolean; baselineAdvanced: boolean }
    expect(advanced).toMatchObject({ status: 'changed', truncated: false, baselineAdvanced: true })
    const afterAdvance = (await call(client, 'browser_snapshot', {
      workspaceId: workspace.id, tabId: deltaTabId, action: 'delta', baselineId: activeBaseline.baselineId
    })).structuredContent as { status: string }
    expect(afterAdvance.status).toBe('unchanged')

    const otherTab = parse<BrowserState>(await call(client, 'browser_new_tab', { workspaceId: workspace.id, url: `${origin}/short` }))
    const tabDrift = (await call(client, 'browser_snapshot', {
      workspaceId: workspace.id, tabId: otherTab.activeTabId!, action: 'delta', baselineId: activeBaseline.baselineId
    })).structuredContent as { status: string; invalidationReason: string }
    expect(tabDrift).toMatchObject({ status: 'invalidated', invalidationReason: 'tab-changed' })
    expect((await call(client, 'browser_navigate', {
      workspaceId: workspace.id, tabId: deltaTabId, url: `${origin}/short`
    })).isError).not.toBe(true)
    const navigationDrift = (await call(client, 'browser_snapshot', {
      workspaceId: workspace.id, tabId: deltaTabId, action: 'delta', baselineId: activeBaseline.baselineId
    })).structuredContent as { status: string; invalidationReason: string }
    expect(navigationDrift).toMatchObject({ status: 'invalidated', invalidationReason: 'navigation' })

    const reconnectBaselineResult = await call(client, 'browser_snapshot', {
      workspaceId: workspace.id, tabId: deltaTabId, action: 'set-baseline'
    })
    const reconnectBaseline = reconnectBaselineResult.structuredContent as { baselineId: string }
    const foreign = await connect()
    expect((await call(foreign, 'browser_snapshot', { workspaceId: workspace.id, tabId: longTabId })).isError).toBe(true)
    await client.close()
    const resumed = await connect()
    parse(await call(resumed, 'browser_workspaces', {
      action: 'resume', workspaceId: workspace.id, resumeKey: workspace.resumeKey
    }))
    const controlDrift = (await call(resumed, 'browser_snapshot', {
      workspaceId: workspace.id, tabId: deltaTabId, action: 'delta', baselineId: reconnectBaseline.baselineId
    })).structuredContent as { status: string; invalidationReason: string }
    expect(controlDrift).toMatchObject({ status: 'invalidated', invalidationReason: 'workspace-control' })
    const cleared = (await call(resumed, 'browser_snapshot', {
      workspaceId: workspace.id, tabId: deltaTabId, action: 'clear-baseline', baselineId: reconnectBaseline.baselineId
    })).structuredContent as { status: string; cleared: boolean }
    expect(cleared).toMatchObject({ status: 'cleared', cleared: true })
    const missing = (await call(resumed, 'browser_snapshot', {
      workspaceId: workspace.id, tabId: deltaTabId, action: 'delta', baselineId: reconnectBaseline.baselineId
    })).structuredContent as { status: string; invalidationReason: string }
    expect(missing).toMatchObject({ status: 'invalidated', invalidationReason: 'baseline-not-found' })
  } finally {
    await Promise.allSettled(clients.map(client => client.close()))
    await closeFixtureServer(fixture)
  }
})
