import { createServer } from 'node:http'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { useMcpWorkspace } from '../../scripts/mcp-workspace.js'
import type { BrowserState, HronautApi } from '../../src/shared/types.js'
import { closeFixtureServer, expect, test } from './fixtures.js'

function text(result: CallToolResult): string {
  return result.content.filter(item => item.type === 'text').map(item => item.text).join('\n')
}

interface FontReport { body: string; px: string; mono: string; emQuery: boolean; remQuery: boolean; zoom: number }

test('creates a tab with its own browser default font size for accessibility QA', async ({ appWindow, electronApp, mcpPort, mcpToken }) => {
  const server = createServer((request, response) => {
    // The authored page fixes the root size, which is not equivalent: em media queries keep the browser default.
    const authoredRoot = request.url?.startsWith('/authored') ? 'html{font-size:32px}' : ''
    response.writeHead(200, { 'content-type': 'text/html' }).end(`<!doctype html><title>Default font</title><style>${authoredRoot}.px{font-size:12px}</style><main><p id="body">Body text</p><p class="px" id="px">Pixel text</p><code id="mono">mono</code></main>`)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing port')
  const origin = `http://127.0.0.1:${address.port}`
  const client = new Client({ name: 'default-font-size-test', version: '1.0.0' })
  try {
    await expect.poll(async () => {
      try { return (await fetch(`http://127.0.0.1:${mcpPort}/healthz`, { headers: { authorization: `Bearer ${mcpToken}` } })).ok } catch { return false }
    }).toBe(true)
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort}/mcp`), { requestInit: { headers: { authorization: `Bearer ${mcpToken}` } } }))
    await useMcpWorkspace(client, 'Default font size', false)
    const call = async (name: string, args: Record<string, unknown>) => {
      const result = await client.callTool({ name, arguments: args }) as CallToolResult
      expect(result.isError, text(result)).not.toBe(true)
      return result
    }
    const tabIds = async () => new Set((await appWindow.evaluate(() => (window as unknown as { hronaut: HronautApi }).hronaut.getState())).tabs.map(tab => tab.id))
    const state = (id: string) => appWindow.evaluate(id => (window as unknown as { hronaut: HronautApi }).hronaut.getState().then(s => s.tabs.find(t => t.id === id)), id)
    const selectTab = (id: string) => appWindow.evaluate(id => (window as unknown as { hronaut: HronautApi }).hronaut.selectTab(id), id)
    const setSleeping = (id: string, sleeping: boolean) => appWindow.evaluate(([id, sleeping]) => (
      (window as unknown as { hronaut: HronautApi }).hronaut.setTabSleeping(id, sleeping)
    ), [id, sleeping] as const)
    const open = async (path: string, extra: Record<string, unknown> = {}) => {
      const before = await tabIds()
      const created = JSON.parse(text(await call('browser_new_tab', { url: origin + path, ...extra }))) as BrowserState
      const tab = created.tabs.find(candidate => !before.has(candidate.id))!
      await call('browser_wait', { tabId: tab.id, timeoutMs: 8_000 })
      return tab
    }
    // The same threshold sits between innerWidth/32 and innerWidth/16 ems, so it matches only at 16px.
    const fonts = async (tabId: string) => JSON.parse(text(await call('browser_evaluate', { tabId, script: `JSON.stringify({
      body: getComputedStyle(document.getElementById('body')).fontSize,
      px: getComputedStyle(document.getElementById('px')).fontSize,
      mono: getComputedStyle(document.getElementById('mono')).fontSize,
      emQuery: matchMedia('(min-width: ' + (innerWidth / 24) + 'em)').matches,
      remQuery: matchMedia('(min-width: ' + (innerWidth / 24) + 'rem)').matches,
      zoom: devicePixelRatio
    })` }))) as FontReport

    const ordinary = await open('/ordinary')
    expect(ordinary).not.toHaveProperty('defaultFontSize')
    const large = await open('/large', { defaultFontSize: 32 })
    expect(large).toMatchObject({ defaultFontSize: 32, zoomPercent: 100 })
    const explicitDefault = await open('/explicit-default', { defaultFontSize: 16 })
    expect(explicitDefault).not.toHaveProperty('defaultFontSize')

    const base = await fonts(ordinary.id)
    expect(base).toMatchObject({ body: '16px', px: '12px', emQuery: true, remQuery: true })
    const enlarged = await fonts(large.id)
    expect(enlarged).toMatchObject({ body: '32px', px: '12px', mono: base.mono, emQuery: false, remQuery: false, zoom: base.zoom })
    expect(await fonts(explicitDefault.id)).toMatchObject({ body: '16px', emQuery: true })
    // Sibling tabs on the same origin keep the browser default.
    expect(await fonts(ordinary.id)).toEqual(base)

    // An authored root size enlarges text but leaves em media queries at the browser default.
    const authored = await open('/authored')
    expect(await fonts(authored.id)).toMatchObject({ body: '32px', emQuery: true, remQuery: true })

    // The preference belongs to the tab, so navigation, reload and sleep keep it.
    await call('browser_navigate', { tabId: large.id, url: `${origin}/large-next` })
    await call('browser_wait', { tabId: large.id, timeoutMs: 8_000 })
    expect(await fonts(large.id)).toMatchObject({ body: '32px', emQuery: false })
    await electronApp.evaluate(({ webContents }, url) => webContents.getAllWebContents().find(c => c.getURL() === url)!.reload(), `${origin}/large-next`)
    await call('browser_wait', { tabId: large.id, timeoutMs: 8_000 })
    expect(await fonts(large.id)).toMatchObject({ body: '32px' })
    await call('browser_screenshot', { tabId: large.id })
    expect(await fonts(large.id)).toMatchObject({ body: '32px' })
    await selectTab(ordinary.id)
    await setSleeping(large.id, true)
    await expect.poll(async () => (await state(large.id))?.sleeping).toBe(true)
    await setSleeping(large.id, false)
    await call('browser_wait', { tabId: large.id, timeoutMs: 8_000 })
    expect(await fonts(large.id)).toMatchObject({ body: '32px', emQuery: false })
    expect(await state(large.id)).toMatchObject({ defaultFontSize: 32 })

    // A reopened tab is recreated with the same preference.
    await call('browser_close_tab', { tabId: large.id })
    const beforeReopen = await tabIds()
    const reopened = (await appWindow.evaluate(() => (window as unknown as { hronaut: HronautApi }).hronaut.reopenClosedTab()))
      .tabs.find(tab => !beforeReopen.has(tab.id))!
    expect(reopened).toMatchObject({ defaultFontSize: 32 })
    await call('browser_wait', { tabId: reopened.id, timeoutMs: 8_000 })
    expect(await fonts(reopened.id)).toMatchObject({ body: '32px', emQuery: false })

    // The trusted zoom bar names the setting only for tabs that have one.
    await selectTab(reopened.id)
    await appWindow.getByRole('button', { name: /^Page zoom controls, \d+%$/ }).click()
    const controls = appWindow.getByRole('group', { name: 'Page zoom controls' })
    await expect(controls.getByTestId('zoom-default-font-size')).toHaveText('Default text 32px')
    await selectTab(ordinary.id)
    await expect(controls.getByTestId('zoom-default-font-size')).toHaveCount(0)

    const before = await tabIds()
    for (const defaultFontSize of [8, 73, 24.5, '24']) {
      const rejected = await client.callTool({ name: 'browser_new_tab', arguments: { url: origin + '/bad', defaultFontSize } }) as CallToolResult
      expect(rejected.isError, String(defaultFontSize)).toBe(true)
    }
    expect(await tabIds()).toEqual(before)
  } finally {
    await client.close().catch(() => undefined)
    await closeFixtureServer(server)
  }
})
