import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { BrowserSnapshot } from '../../src/shared/snapshot.js'
import type { AppSettings, BrowserState } from '../../src/shared/types.js'
import { closeFixtureServer, expect, test } from './fixtures.js'

test('hides URL query and fragment from agents only while the person asks, without changing the real address', async ({ appWindow, mcpPort, mcpToken }) => {
  const site = createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' })
    // The untitled page gets Chromium's address title, which would repeat its query.
    response.end(request.url?.startsWith('/untitled') ? '<!doctype html><p>No title here</p>' : '<!doctype html><title>Checkout</title><h1>Checkout</h1><button>Pay</button>'
      + '<x-card id="card"></x-card><script>customElements.define("x-card", class extends HTMLElement { constructor() { super(); this.attachShadow({ mode: "open" }).innerHTML = "<p>Card body</p>" } })</script>')
  })
  await new Promise<void>(resolve => site.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${(site.address() as AddressInfo).port}`
  const checkout = `${origin}/checkout?session=query-canary#fragment-canary`
  const untitled = `${origin}/untitled?token=title-canary`
  const client = new Client({ name: 'url-detail-test', version: '1' })
  const call = (name: string, args: Record<string, unknown>) => client.callTool({ name, arguments: args }) as Promise<CallToolResult>
  const text = (result: CallToolResult): string => {
    expect(result.isError).not.toBe(true)
    return result.content.filter(part => part.type === 'text').map(part => part.text).join('\n')
  }
  const setOmit = (enabled: boolean) => appWindow.evaluate(`window.hronautSettings.setOmitAgentUrlDetail(${enabled})`) as Promise<AppSettings>
  const canaries = ['query-canary', 'fragment-canary', 'title-canary']
  try {
    await expect.poll(async () => { try { return (await fetch(`http://127.0.0.1:${mcpPort}/healthz`)).ok } catch { return false } }).toBe(true)
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort}/mcp`), { requestInit: { headers: { authorization: `Bearer ${mcpToken}` } } }))
    const workspace = JSON.parse(text(await call('browser_workspaces', { action: 'create', name: 'URL detail' }))) as { id: string }
    const opened = JSON.parse(text(await call('browser_new_tab', { workspaceId: workspace.id, url: checkout, active: true }))) as BrowserState
    const tabId = opened.activeTabId!
    const args = { workspaceId: workspace.id, tabId }
    text(await call('browser_new_tab', { workspaceId: workspace.id, url: untitled, active: false }))
    await expect.poll(async () => text(await call('browser_status', { workspaceId: workspace.id }))).toContain('title-canary')

    // Off by default: agents read the whole address, as before.
    expect((await appWindow.evaluate('window.hronautSettings.get()') as AppSettings).omitAgentUrlDetail).toBe(false)
    expect(text(await call('browser_status', { workspaceId: workspace.id }))).toContain('query-canary')
    const fullBaseline = (await call('browser_snapshot', { ...args, action: 'set-baseline' })).structuredContent as { baselineId: string }

    expect(await setOmit(true)).toMatchObject({ omitAgentUrlDetail: true })
    const status = await call('browser_status', { workspaceId: workspace.id })
    for (const canary of canaries) expect(text(status), canary).not.toContain(canary)
    const state = JSON.parse(text(status)) as { urlDetail: string; tabs: Array<{ url: string; title: string; urlDetail: string }> }
    expect(state.urlDetail).toBe('omitted')
    expect(state.tabs).toEqual(expect.arrayContaining([
      expect.objectContaining({ url: `${origin}/checkout`, title: 'Checkout', urlDetail: 'omitted' }),
      expect.objectContaining({ url: `${origin}/untitled`, title: `${origin}/untitled`, urlDetail: 'omitted' })
    ]))
    const tabs = text(await call('browser_tabs', { workspaceId: workspace.id }))
    const search = text(await call('browser_tabs', { workspaceId: workspace.id, search: { query: 'checkout' } }))
    for (const canary of canaries) expect(tabs + search, canary).not.toContain(canary)
    expect(JSON.parse(search)).toMatchObject({ urlDetail: 'omitted', tabs: [{ url: `${origin}/checkout` }] })

    const snapshot = await call('browser_snapshot', args)
    expect((snapshot.structuredContent as unknown as BrowserSnapshot).urlDetail).toBe('omitted')
    expect(text(snapshot)).toContain(`URL: ${origin}/checkout (query and fragment omitted)`)
    const found = text(await call('browser_find', { ...args, query: 'URL' }))
    for (const canary of canaries) expect(text(snapshot) + found, canary).not.toContain(canary)
    const shadow = text(await call('browser_snapshot', { ...args, shadowHostSelector: '#card' }))
    expect(shadow).toContain('Card body')
    expect(shadow).toContain(`${origin}/checkout (query and fragment omitted)`)
    const quality = await call('browser_snapshot', { ...args, action: 'assess-quality' })
    expect(JSON.parse(text(quality))).toMatchObject({ resolvedUrl: `${origin}/checkout`, urlDetail: 'omitted' })
    const waited = text(await call('browser_wait', { ...args, urlPattern: `${origin}/checkout*` }))
    expect(waited).toBe(`URL matched: ${origin}/checkout (query and fragment omitted)`)
    const visual = text(await call('browser_visual_compare', { ...args, action: 'set-baseline' }))
    expect(JSON.parse(visual)).toMatchObject({ url: `${origin}/checkout`, title: 'Checkout', baseline: { url: `${origin}/checkout` }, urlDetail: 'omitted' })
    for (const canary of canaries) expect(shadow + text(quality) + waited + visual, canary).not.toContain(canary)
    // A baseline from before the change is not compared line by line, which would repeat the old address.
    const delta = await call('browser_snapshot', { ...args, action: 'delta', baselineId: fullBaseline.baselineId })
    expect(delta.structuredContent).toMatchObject({ status: 'invalidated', invalidationReason: 'snapshot-format', changes: [] })
    expect(text(delta)).not.toContain('query-canary')

    // A navigation result is the workspace state too.
    const navigated = text(await call('browser_navigate', { ...args, url: `${origin}/checkout?session=query-canary-2#fragment-canary` }))
    for (const canary of canaries) expect(navigated, canary).not.toContain(canary)

    // The real address is unchanged for browsing and the person.
    const real = await appWindow.evaluate('window.hronaut.getState()') as BrowserState
    expect(real.tabs.find(tab => tab.id === tabId)?.url).toBe(`${origin}/checkout?session=query-canary-2#fragment-canary`)

    expect(await setOmit(false)).toMatchObject({ omitAgentUrlDetail: false })
    const restored = text(await call('browser_status', { workspaceId: workspace.id }))
    expect(restored).toContain('query-canary-2')
    expect(restored).not.toContain('"urlDetail"')

    // A saved workspace keeps the full addresses for reopening, and agents still read them without detail.
    await setOmit(true)
    const saved = text(await call('browser_saved_workspaces', { action: 'save', workspaceId: workspace.id }))
    const list = text(await call('browser_saved_workspaces', { action: 'list' }))
    for (const canary of canaries) expect(saved + list, canary).not.toContain(canary)
    expect(JSON.parse(saved)).toMatchObject({ urlDetail: 'omitted', tabs: expect.arrayContaining([expect.objectContaining({ url: `${origin}/checkout` })]) })
  } finally {
    await setOmit(false).catch(() => undefined)
    await client.close().catch(() => undefined)
    await closeFixtureServer(site)
  }
})
