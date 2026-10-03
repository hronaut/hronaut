import { createServer } from 'node:http'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { BrowserState } from '../../src/shared/types.js'
import { closeFixtureServer, expect, test } from './fixtures.js'

test('keeps snapshot deltas bound to their component without exposing selectors or outside content', async ({ electronApp, mcpPort, mcpToken }) => {
  const html = '<!doctype html><title>Scoped delta</title>'
    + '<section id="outside"><h2>Outside before</h2><button>Save</button></section>'
    + '<form id="private-scope-canary"><h2>Inside before</h2><button type="button">Save</button><input value="private-value-canary"></form>'
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' }).end(html)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture port')
  const url = `http://127.0.0.1:${address.port}/`
  const client = new Client({ name: 'scoped-delta-test', version: '1' })
  const call = (name: string, args: Record<string, unknown>) => client.callTool({ name, arguments: args }) as Promise<CallToolResult>
  const parsed = <T>(result: CallToolResult): T => {
    expect(result.isError).not.toBe(true)
    return JSON.parse(result.content.filter(part => part.type === 'text').map(part => part.text).join('\n')) as T
  }
  try {
    await expect.poll(async () => { try { return (await fetch(`http://127.0.0.1:${mcpPort}/healthz`)).ok } catch { return false } }).toBe(true)
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort}/mcp`), {
      requestInit: { headers: { authorization: `Bearer ${mcpToken}` } }
    }))
    const workspace = parsed<{ id: string }>(await call('browser_workspaces', { action: 'create', name: 'Scoped delta', storage: 'scratch' }))
    const state = parsed<BrowserState>(await call('browser_new_tab', { workspaceId: workspace.id, url }))
    const args = { workspaceId: workspace.id, tabId: state.activeTabId! }
    await expect.poll(() => electronApp.context().pages().some(page => page.url() === url)).toBe(true)
    const page = electronApp.context().pages().find(page => page.url() === url)!
    await expect(page.locator('form')).toBeVisible()
    const rootSelector = '#private-scope-canary'
    const baseline = await call('browser_snapshot', { ...args, action: 'set-baseline', rootSelector })
    expect(baseline.isError).not.toBe(true)
    const saved = baseline.structuredContent as { baselineId: string; captureId: string; scope: unknown }
    expect(saved.scope).toMatchObject({ kind: 'component', rootTag: 'form', outsideScopeOmitted: true })
    expect(JSON.stringify(baseline)).not.toMatch(/Outside before|private-scope-canary|private-value-canary/)
    const deltaArgs = { ...args, action: 'delta', baselineId: saved.baselineId }
    // Intervening whole-page captures must not widen the stored baseline scope.
    await call('browser_snapshot', args)
    await page.locator('#outside h2').evaluate(element => { element.textContent = 'Outside after' })
    const unchanged = parsed<{ status: string; sourceSnapshot: { captureId: string; scope: unknown } }>(await call('browser_snapshot', deltaArgs))
    expect(unchanged.status).toBe('unchanged')
    expect(unchanged.sourceSnapshot.scope).toEqual(saved.scope)
    expect(unchanged.sourceSnapshot.captureId).not.toBe(saved.captureId)
    await page.locator('form h2').evaluate(element => { element.textContent = 'Inside after' })
    const changed = parsed<{ status: string; baselineAdvanced: boolean }>(await call('browser_snapshot', { ...deltaArgs, advanceBaseline: false }))
    expect(changed).toMatchObject({ status: 'changed', baselineAdvanced: false })
    expect(JSON.stringify(changed)).toContain('Inside after')
    expect(JSON.stringify(changed)).not.toMatch(/Outside|private-scope-canary|private-value-canary/)
    expect(parsed(await call('browser_snapshot', { ...deltaArgs, rootSelector: '#outside' }))).toMatchObject({
      status: 'invalidated', invalidationReason: 'scope-changed', changes: []
    })
    expect(parsed(await call('browser_snapshot', { ...deltaArgs, rootSelector }))).toMatchObject({ status: 'changed', baselineAdvanced: true })
    expect(parsed(await call('browser_snapshot', deltaArgs))).toMatchObject({ status: 'unchanged' })
    await page.locator('form').evaluate(element => element.remove())
    expect((await call('browser_snapshot', deltaArgs)).isError).toBe(true)
    await page.locator('body').evaluate(element => {
      element.insertAdjacentHTML('beforeend', '<section id="private-scope-canary"><h2>Replacement</h2></section>')
    })
    const replaced = parsed(await call('browser_snapshot', deltaArgs))
    expect(replaced).toMatchObject({ status: 'changed', sourceSnapshot: { scope: { rootTag: 'section' } } })
    await page.locator(rootSelector).evaluate(element => element.after(element.cloneNode(true)))
    expect((await call('browser_snapshot', deltaArgs)).isError).toBe(true)
    await page.goto(`${url}?next=1`)
    expect(parsed(await call('browser_snapshot', deltaArgs))).toMatchObject({ status: 'invalidated', invalidationReason: 'navigation' })
    const whole = await call('browser_snapshot', { ...args, action: 'set-baseline' })
    expect(whole.isError).not.toBe(true)
    expect(parsed(await call('browser_snapshot', {
      ...deltaArgs, baselineId: (whole.structuredContent as { baselineId: string }).baselineId, rootSelector
    }))).toMatchObject({ status: 'invalidated', invalidationReason: 'scope-changed' })
  } finally {
    await client.close()
    await closeFixtureServer(server)
  }
})
