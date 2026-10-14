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

test('keeps an explicitly isolated tab zoom independent of same-origin tabs', async ({ appWindow, electronApp, mcpPort, mcpToken }) => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' }).end('<!doctype html><title>Zoom isolation</title><main>Zoom isolation</main>')
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing port')
  const origin = `http://127.0.0.1:${address.port}`
  const client = new Client({ name: 'isolated-zoom-test', version: '1.0.0' })
  try {
    await expect.poll(async () => {
      try { return (await fetch(`http://127.0.0.1:${mcpPort}/healthz`, { headers: { authorization: `Bearer ${mcpToken}` } })).ok } catch { return false }
    }).toBe(true)
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort}/mcp`), { requestInit: { headers: { authorization: `Bearer ${mcpToken}` } } }))
    await useMcpWorkspace(client, 'Isolated zoom', false)
    const call = async (name: string, args: Record<string, unknown>) => {
      const result = await client.callTool({ name, arguments: args }) as CallToolResult
      expect(result.isError, text(result)).not.toBe(true)
      return result
    }
    const open = async (path: string, extra: Record<string, unknown> = {}) => {
      const before = new Set((await appWindow.evaluate(() => (window as unknown as { hronaut: HronautApi }).hronaut.getState())).tabs.map(tab => tab.id))
      const state = JSON.parse(text(await call('browser_new_tab', { url: origin + path, ...extra }))) as BrowserState
      const tab = state.tabs.find(candidate => !before.has(candidate.id))!
      await call('browser_wait', { tabId: tab.id, timeoutMs: 8_000 })
      return tab
    }
    const zoom = (path: string) => electronApp.evaluate(({ webContents }, url) => webContents.getAllWebContents().find(c => c.getURL() === url)!.getZoomFactor(), origin + path)
    const state = (id: string) => appWindow.evaluate(id => (window as unknown as { hronaut: HronautApi }).hronaut.getState().then(s => s.tabs.find(t => t.id === id)), id)

    // A pre-existing non-100% shared origin zoom does not leak into an isolated tab.
    const shared = await open('/shared')
    expect(shared).not.toHaveProperty('zoomIsolated')
    await call('browser_zoom', { tabId: shared.id, action: 'set', percent: 200 })
    const sibling = await open('/sibling')
    await expect.poll(() => zoom('/sibling')).toBeCloseTo(2, 8)
    const isolated = await open('/isolated', { zoomIsolated: true })
    expect(isolated).toMatchObject({ zoomIsolated: true, zoomPercent: 100 })
    expect(await zoom('/isolated')).toBe(1)
    await open('/isolated-two', { zoomIsolated: true })

    for (const percent of [400, 200, 100, 50]) {
      await call('browser_zoom', { tabId: isolated.id, action: 'set', percent })
      expect(await zoom('/isolated')).toBeCloseTo(percent / 100, 8)
      expect(await zoom('/isolated-two')).toBe(1)
      expect(await zoom('/shared')).toBeCloseTo(2, 8)
      expect(await zoom('/sibling')).toBeCloseTo(2, 8)
    }
    // Shared changes stay out of isolated tabs, including after navigation and reload.
    await call('browser_zoom', { tabId: shared.id, action: 'set', percent: 300 })
    await expect.poll(() => zoom('/sibling')).toBeCloseTo(3, 8)
    expect(await zoom('/isolated')).toBeCloseTo(0.5, 8)
    await call('browser_zoom', { tabId: isolated.id, action: 'in' })
    expect((await state(isolated.id))?.zoomPercent).toBeGreaterThan(50)
    await call('browser_zoom', { tabId: isolated.id, action: 'reset' })
    await call('browser_navigate', { tabId: isolated.id, url: `${origin}/isolated-next` })
    await call('browser_wait', { tabId: isolated.id, timeoutMs: 8_000 })
    await call('browser_zoom', { tabId: isolated.id, action: 'set', percent: 150 })
    expect(await zoom('/isolated-next')).toBeCloseTo(1.5, 8)
    expect(await zoom('/sibling')).toBeCloseTo(3, 8)
    await electronApp.evaluate(({ webContents }, url) => webContents.getAllWebContents().find(c => c.getURL() === url)!.reload(), `${origin}/isolated-next`)
    await call('browser_wait', { tabId: isolated.id, timeoutMs: 8_000 })
    expect(await zoom('/isolated-next')).toBeCloseTo(1.5, 8)
    expect(await state(isolated.id)).toMatchObject({ zoomIsolated: true, zoomPercent: 150 })

    // The trusted zoom bar names the mode only for isolated tabs.
    await appWindow.evaluate(id => (window as unknown as { hronaut: HronautApi }).hronaut.selectTab(id), isolated.id)
    await appWindow.keyboard.press('Control+0')
    await expect.poll(() => zoom('/isolated-next')).toBe(1)
    await appWindow.getByRole('button', { name: 'Page zoom controls', exact: true }).click()
    const controls = appWindow.getByRole('group', { name: 'Page zoom controls' })
    await expect(controls.getByTestId('zoom-isolated')).toHaveText('This tab only')
    await appWindow.evaluate(id => (window as unknown as { hronaut: HronautApi }).hronaut.selectTab(id), sibling.id)
    await expect(controls.getByTestId('zoom-isolated')).toHaveCount(0)

    expect((await client.callTool({ name: 'browser_new_tab', arguments: { url: origin + '/bad', zoomIsolated: 'yes' } }) as CallToolResult).isError).toBe(true)
  } finally {
    await client.close().catch(() => undefined)
    await closeFixtureServer(server)
  }
})
